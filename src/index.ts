import { resolveConfig, TokenSaverSchema, DEFAULTS } from './config.js'
import type { ResolvedConfig, TokenSaverConfig } from './internal.js'
import { decidePostTool } from './strategies/tool-result-trim.js'
import { decidePreStep } from './strategies/context-pressure.js'
import { createRtkStats, mergeRtkStats, type RtkStats } from './rtk/index.js'
import { SettingsManager } from './settings.js'
import { StatsStore } from './stats-store.js'
import { createApiRoutes } from './routes.js'
import { activePrompts } from './prompt-shaping/index.js'
import {
  detectOptimization,
  createLocalResponseStream,
  localAnswerEstimate,
  type RequestLike,
} from './local-responses/index.js'
import type {
  PostToolDecision,
  PreStepDecisionLike,
  ToolExecutionLike,
  ToolResultLike,
  AgentLike,
  TokenMeterLike,
} from './types.js'

export interface TokenSaverPluginOptions {
  readonly config?: TokenSaverConfig
  readonly name?: string
  readonly logger?: Logger
}

export const name = 'dsh-token-saver'

export const Config = TokenSaverSchema

export const inject = ['tools'] as const

export interface Logger {
  debug: (msg: string, ...rest: readonly unknown[]) => void
  info: (msg: string, ...rest: readonly unknown[]) => void
  warn: (msg: string, ...rest: readonly unknown[]) => void
  error: (msg: string, ...rest: readonly unknown[]) => void
}

export interface CordisScope {
  on(event: string, listener: (...args: readonly unknown[]) => unknown, options?: unknown): void
  effect(disposer: () => void): void
  get(key: string): unknown
  effectDispose(): void
  inject?(
    dependencies: readonly string[],
    callback: (scoped: CordisScope & Record<string, unknown>) => void,
  ): unknown
}

export async function apply(rawScope: unknown, rawConfig: unknown): Promise<void> {
  const scope = asScope(rawScope)
  if (!scope) {
    throw new Error('token-saver: invalid Cordis scope')
  }
  const resolved = resolveConfig(asTokenSaverConfig(rawConfig))
  const ownLogger = createDefaultLogger()
  ownLogger.info(
    `token-saver: mode=${resolved.mode} rtk=${resolved.rtkEnabled} caveman=${resolved.cavemanLevel} ponytail=${resolved.ponytailLevel} localResponses=${resolved.localResponsesEnabled}`,
  )

  const tokenMeter = makeTokenMeterAccessor(scope)
  const compactionEngine = makeCompactionAccessor(scope)
  const agentForSession = makeAgentAccessor(scope)
  // Two views of the same figures: `rtkStats` accumulates this process's
  // compression, `statsStore` persists the historical totals across restarts.
  const rtkStats: RtkStats = createRtkStats()
  const statsStore = new StatsStore()

  const settingsManager = new SettingsManager()
  const runtimeState = settingsManager.init(resolved, rtkStats, () => statsStore.get())

  // Mount WebServer API routes if webServer service is available
  if (typeof (scope as any).inject === 'function') {
    ;(scope as any).inject(['webServer'], (scoped: any) => {
      const server = scoped.webServer
      if (server && typeof server.register === 'function') {
        const apiHandler = createApiRoutes({
          getSaver: () => settingsManager.getPublicTokenSaver(runtimeState),
          setSaver: patch => settingsManager.updateTokenSaver(runtimeState, patch),
          getLocal: () => settingsManager.getPublicLocalOptimize(runtimeState),
          setLocal: patch => settingsManager.updateLocalOptimize(runtimeState, patch),
        })
        const unregister = server.register({
          kind: 'prefix',
          path: '/api/token-saver',
          handler: apiHandler,
        })
        if (typeof unregister === 'function' && typeof scoped.effect === 'function') {
          scoped.effect(() => () => unregister())
        }
        ownLogger.info('token-saver: web API mounted at /api/token-saver')
      }
    })
  }

  // 1) Tool result trimming + RTK filter hook
  const trimmedListener = (
    arg1: unknown,
    arg2: unknown,
    arg3?: unknown,
  ): Promise<PostToolDecision> => {
    if (!runtimeState.enabled || (runtimeState.config.mode === 'off' && !runtimeState.config.rtkEnabled)) {
      if (typeof arg3 === 'function') {
        return (arg3 as () => Promise<PostToolDecision>)()
      }
      if (typeof arg2 === 'function') {
        return (arg2 as () => Promise<PostToolDecision>)()
      }
      return Promise.resolve({ kind: 'accept' as const })
    }
    // DSH waterfall event 'tools/post-execute' passes 3 arguments:
    // (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>)
    if (typeof arg3 === 'function') {
      const exec = arg1 as ToolExecutionLike
      const result = (arg2 ?? {}) as Readonly<ToolResultLike>
      const next = arg3 as () => Promise<PostToolDecision>
      return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore)
    }
    // Backward compatibility for 2-argument signature: ({ exec, result }, next)
    if (typeof arg2 === 'function') {
      const payload = arg1 as { exec?: ToolExecutionLike; result?: ToolResultLike } | undefined
      const exec = payload?.exec ?? (arg1 as ToolExecutionLike)
      const result = (payload?.result ?? {}) as Readonly<ToolResultLike>
      const next = arg2 as () => Promise<PostToolDecision>
      return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore)
    }
    // Defensive fallback when invoked without next
    const exec = arg1 as ToolExecutionLike
    const result = (arg2 ?? {}) as Readonly<ToolResultLike>
    const next = () => Promise.resolve({ kind: 'accept' as const })
    return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore)
  }

  // 2) Context pressure pre-step hook
  const preStepListener = (rawPayload: unknown, rawNext: unknown) => {
    const next = typeof rawNext === 'function'
      ? (rawNext as () => Promise<PreStepDecisionLike>)
      : () => Promise.resolve({ kind: 'enter' as const })
    if (!runtimeState.enabled) {
      return next()
    }
    return handlePreStep(rawPayload, next, runtimeState.config, {
      logger: ownLogger,
      telemetry: runtimeState.config.telemetry,
      getTokenMeter: tokenMeter,
      getCompactionEngine: compactionEngine,
      agentForSession,
    })
  }

  scope.on('tools/post-execute', trimmedListener)
  scope.on('agent/pre-step', preStepListener)

  // 2b) Prompt shaping through the supported `ctx.systemPrompt.section()` API.
  //
  // DSH builds the model-facing system prompt from ordered sections, and the
  // official way for a plugin to contribute text is a registered section. The
  // text provider is re-evaluated on every assembly, so enabling or disabling
  // Caveman/Ponytail at runtime takes effect on the next model step without
  // reloading the plugin.
  if (typeof scope.inject === 'function') {
    scope.inject(['systemPrompt'], (scoped) => {
      const systemPrompt = scoped.systemPrompt as
        | {
            section?: (section: {
              name: string
              order: number
              text: string | (() => string)
              interpolate?: boolean
            }) => (() => void) | undefined
          }
        | undefined
      if (!systemPrompt || typeof systemPrompt.section !== 'function') return

      const dispose = systemPrompt.section({
        name: 'token-saver:prompt-shaping',
        order: 9500,
        // The shaping prompt is literal text, never a template: DSH must not
        // try to resolve `{{…}}` references inside it.
        interpolate: false,
        text: () => {
          if (!runtimeState.enabled) return ''
          const cfg = runtimeState.config
          if (cfg.cavemanLevel === 'off' && cfg.ponytailLevel === 'off') return ''
          const text = activePrompts({
            caveman: cfg.cavemanLevel,
            ponytail: cfg.ponytailLevel,
          })
            .map((p) => p.text)
            .join('\n\n')
          // A shaped prompt saves no bytes at the moment it is injected, so it
          // has its own counter: `promptCalls` is the only place a prompt-only
          // step shows up in the dashboard.
          if (text) statsStore.record(null, true)
          return text
        },
      })
      if (typeof dispose === 'function' && typeof scoped.effect === 'function') {
        scoped.effect(() => () => dispose())
      }
    })
  }

  // 3) Global LLM Stream hook: local responses.
  //
  // The agent loop deep-freezes the request it hands to `llm/stream`, so a
  // listener must treat `options` as read-only. Prompt shaping is delivered
  // through `ctx.systemPrompt.section()` (above) and tool-result trimming
  // through `tools/post-execute`; this hook only short-circuits well-known
  // local requests with its own stream.
  const llmStreamListener = function (
    options: unknown,
    next: () => AsyncIterable<unknown>,
  ): AsyncIterable<unknown> {
    try {
      const req = options as RequestLike | undefined

      if (!runtimeState.enabled) {
        return next()
      }
      const currentConfig = runtimeState.config

      if (currentConfig.localResponsesEnabled && req) {
        const answer = detectOptimization(req, currentConfig.localResponses)
        if (answer !== null) {
          ownLogger.debug(`token-saver: local response triggered for kind=${answer.kind}`)
          if (currentConfig.telemetry?.onLocalResponse) {
            // The estimates are the SIMULATED cost of the upstream call this
            // local answer replaced. They are reported as estimates only —
            // the stream itself reports zero real consumption, because no
            // upstream model was called.
            const estimate = localAnswerEstimate(answer)
            currentConfig.telemetry.onLocalResponse({
              kind: answer.kind,
              model: answer.model,
              promptTokensEstimate: estimate.promptTokensEstimate,
              savedTokensEstimate: estimate.savedTokensEstimate,
            })
          }
          return createLocalResponseStream(answer)
        }
      }
    } catch (err) {
      // Fail-open: log and let regular LLM handle the request
      ownLogger.warn(`token-saver: llm/stream hook error: ${(err as Error).message}`)
    }

    return next()
  }

  scope.on('llm/stream', llmStreamListener as unknown as (...args: readonly unknown[]) => unknown)

  // 4) Compaction is a capability seam: a provider is chosen by a cordis.yml
  // row, never replaced by mutating another plugin's service at runtime. The
  // LLM-summary engine stays exported for programmatic use, but this plugin
  // does not swap `ctx.compaction` out from under its owner.
  if (resolved.replaceBasicCompaction) {
    ownLogger.warn(
      'token-saver: replaceBasicCompaction is not applied — the compaction seam replaces providers through cordis.yml. Remove the option or load a compaction provider there.',
    )
  }

  if (typeof scope.effect === 'function') {
    scope.effect(() => () => {
      ownLogger.info('token-saver: unloading plugin')
    })
  }
}

async function handlePostTool(
  exec: ToolExecutionLike | undefined,
  result: Readonly<ToolResultLike> | undefined,
  next: () => Promise<PostToolDecision>,
  resolved: ResolvedConfig,
  rtkStats?: RtkStats,
  statsStore?: StatsStore,
): Promise<PostToolDecision> {
  const payload = { exec, result }
  // A per-call accumulator keeps one tool result from being counted into the
  // session totals and the persisted totals a second time.
  const callStats = createRtkStats()
  const folded = decidePostTool(payload, {
    config: resolved,
    telemetry: resolved.telemetry,
    rtkStats: callStats,
  })
  const upstream = typeof next === 'function' ? await next() : { kind: 'accept' as const }
  if (!folded.folded) return upstream
  if (upstream.kind === 'block') return upstream
  if (upstream.kind === 'accept' && upstream.value !== undefined) return upstream
  // Only the folded result that actually reaches the model counts as savings.
  if (rtkStats) mergeRtkStats(rtkStats, callStats)
  statsStore?.record(callStats)
  return { ...upstream, ...folded.decision }
}

async function handlePreStep(
  rawPayload: unknown,
  next: () => Promise<PreStepDecisionLike>,
  resolved: ResolvedConfig,
  ctx: {
    readonly logger: Logger
    readonly telemetry: ResolvedConfig['telemetry']
    readonly getTokenMeter: (id: string) => TokenMeterLike | undefined
    readonly getCompactionEngine: () => import('./types').CompactionEngineLike | undefined
    readonly agentForSession: (id: string) => unknown
  },
): Promise<PreStepDecisionLike> {
  const payload = rawPayload as Parameters<typeof decidePreStep>[0]
  return decidePreStep(
    payload,
    {
      config: resolved,
      logger: ctx.logger,
      telemetry: ctx.telemetry,
      getTokenMeter: ctx.getTokenMeter,
      getCompactionEngine: ctx.getCompactionEngine,
      agentForSession: ctx.agentForSession,
    },
    next,
  )
}

function asScope(input: unknown): CordisScope | undefined {
  if (!input || typeof input !== 'object') return undefined
  const obj = input as Record<string, unknown>
  if (typeof obj.on !== 'function') return undefined
  if (typeof obj.effect !== 'function') return undefined
  return obj as unknown as CordisScope
}

function asTokenSaverConfig(input: unknown): TokenSaverConfig {
  if (!input || typeof input !== 'object') return {}
  return input as TokenSaverConfig
}

function makeTokenMeterAccessor(scope: CordisScope): (sessionId: string) => TokenMeterLike | undefined {
  return (sessionId) => {
    const tm = scope.get('tokenMeter')
    if (!tm || typeof tm !== 'object') return undefined
    const obj = tm as Record<string, unknown>
    if (typeof obj.for === 'function') {
      const meter = (obj.for as (id: string) => unknown)(sessionId)
      return meter && typeof meter === 'object' ? (meter as TokenMeterLike) : undefined
    }
    if ('current' in obj && 'capacity' in obj) return obj as unknown as TokenMeterLike
    return undefined
  }
}

function makeCompactionAccessor(scope: CordisScope): () => import('./types').CompactionEngineLike | undefined {
  return () => {
    const engine = scope.get('compaction')
    if (!engine || typeof engine !== 'object') return undefined
    return engine as import('./types').CompactionEngineLike
  }
}

function makeAgentAccessor(scope: CordisScope): (sessionId: string) => AgentLike | undefined {
  return (sessionId) => {
    const agents = scope.get('agents')
    if (!agents || typeof agents !== 'object') return undefined
    const obj = agents as Record<string, unknown>
    if (typeof obj.for === 'function') {
      const a = (obj.for as (id: string) => unknown)(sessionId)
      return a && typeof a === 'object' ? (a as AgentLike) : undefined
    }
    return undefined
  }
}

function createDefaultLogger(): Logger {
  const prefix = '[token-saver]'
  return {
    debug: (msg, ...rest) => console.debug(prefix, msg, ...rest),
    info: (msg, ...rest) => console.info(prefix, msg, ...rest),
    warn: (msg, ...rest) => console.warn(prefix, msg, ...rest),
    error: (msg, ...rest) => console.error(prefix, msg, ...rest),
  }
}

export { DEFAULT_COMPACTION_PROMPT, LlmSummaryCompactionEngine } from './strategies/llm-summary.js'
export { decidePostTool } from './strategies/tool-result-trim.js'
export { decidePreStep } from './strategies/context-pressure.js'
export { stabilizeForCache } from './strategies/prompt-cache.js'
export { resolveConfig, TokenSaverSchema, DEFAULTS }
export * from './rtk/index.js'
export * from './prompt-shaping/index.js'
export * from './local-responses/index.js'
export * from './token-saver/index.js'
export type { ResolvedConfig, TokenSaverConfig } from './internal.js'
export type { ToolContentBlock, ToolResultLike, ToolExecutionLike } from './types.js'
