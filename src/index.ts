import { resolveConfig, TokenSaverSchema, DEFAULTS } from './config.js'
import type { ResolvedConfig, TokenSaverConfig } from './internal.js'
import { decidePostTool } from './strategies/tool-result-trim.js'
import { decidePreStep } from './strategies/context-pressure.js'
import { stabilizeForCache } from './strategies/prompt-cache.js'
import { LlmSummaryCompactionEngine, DEFAULT_COMPACTION_PROMPT } from './strategies/llm-summary.js'
import { createRtkStats, compressMessages, type RtkStats } from './rtk/index.js'
import { SettingsManager } from './settings.js'
import { createApiRoutes } from './routes.js'
import {
  activePrompts,
  injectSystem,
} from './prompt-shaping/index.js'
import {
  detectOptimization,
  createLocalResponseStream,
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
  const callLlm = makeLlmCaller(resolved, ownLogger)
  const sessionEventsProvider = makeSessionEventsAccessor(scope)
  const rtkStats: RtkStats = createRtkStats()

  const settingsManager = new SettingsManager()
  const runtimeState = settingsManager.init(resolved, rtkStats)

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
  } else if ((scope as any).webServer) {
    const server = (scope as any).webServer
    if (server && typeof server.register === 'function') {
      const apiHandler = createApiRoutes({
        getSaver: () => settingsManager.getPublicTokenSaver(runtimeState),
        setSaver: patch => settingsManager.updateTokenSaver(runtimeState, patch),
        getLocal: () => settingsManager.getPublicLocalOptimize(runtimeState),
        setLocal: patch => settingsManager.updateLocalOptimize(runtimeState, patch),
      })
      server.register({
        kind: 'prefix',
        path: '/api/token-saver',
        handler: apiHandler,
      })
      ownLogger.info('token-saver: web API mounted at /api/token-saver')
    }
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
      return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats)
    }
    // Backward compatibility for 2-argument signature: ({ exec, result }, next)
    if (typeof arg2 === 'function') {
      const payload = arg1 as { exec?: ToolExecutionLike; result?: ToolResultLike } | undefined
      const exec = payload?.exec ?? (arg1 as ToolExecutionLike)
      const result = (payload?.result ?? {}) as Readonly<ToolResultLike>
      const next = arg2 as () => Promise<PostToolDecision>
      return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats)
    }
    // Defensive fallback when invoked without next
    const exec = arg1 as ToolExecutionLike
    const result = (arg2 ?? {}) as Readonly<ToolResultLike>
    const next = () => Promise.resolve({ kind: 'accept' as const })
    return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats)
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

  // 3) Global LLM Stream hook: Local responses & Prompt shaping
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

      // A) Local responses (quota, prefix, title, suggestion, filepath)
      if (currentConfig.localResponsesEnabled && req) {
        const answer = detectOptimization(req, currentConfig.localResponses)
        if (answer !== null) {
          ownLogger.debug(`token-saver: local response triggered for kind=${answer.kind}`)
          if (currentConfig.telemetry?.onLocalResponse) {
            currentConfig.telemetry.onLocalResponse({
              kind: answer.kind,
              model: answer.model,
            })
          }
          return createLocalResponseStream(answer)
        }
      }

      // B) Prompt shaping (Caveman & Ponytail)
      if (currentConfig.cavemanLevel !== 'off' || currentConfig.ponytailLevel !== 'off') {
        const active = activePrompts({
          caveman: currentConfig.cavemanLevel,
          ponytail: currentConfig.ponytailLevel,
        })
        if (active.length > 0 && req) {
          const promptText = active.map((p) => p.text).join('\n\n')
          try {
            injectSystem(req, undefined, promptText)
          } catch {
            // Frozen/readonly options: skip injection, fail open.
          }
        }
      }

      // C) In-flight request tool message compaction (RTK)
      if (currentConfig.rtkEnabled && req) {
        try {
          compressMessages(req, { enabled: true })
        } catch {
          // Frozen/readonly options: skip, fail open.
        }
      }
    } catch (err) {
      // Fail-open: log and let regular LLM handle the request
      ownLogger.warn(`token-saver: llm/stream hook error: ${(err as Error).message}`)
    }

    return next()
  }

  scope.on('llm/stream', llmStreamListener as unknown as (...args: readonly unknown[]) => unknown)

  // 4) Prompt-cache layout stabilization
  const systemPromptRegistry = makeSystemPromptRegistry(scope)
  if (systemPromptRegistry) {
    systemPromptRegistry.register((sections: unknown) => {
      const arr = Array.isArray(sections) ? sections : []
      const result = stabilizeForCache({
        sections: arr as Parameters<typeof stabilizeForCache>[0]['sections'],
        config: resolved,
      })
      if (result.reordered) {
        ownLogger.debug(
          `token-saver: prompt-cache stable reorder applied (cacheable=${result.cacheableRatio.toFixed(2)})`,
        )
      }
      return result.sections
    })
  }

  // 5) Optional LLM-summary compaction replacement
  if (resolved.replaceBasicCompaction) {
    const engineImpl = new LlmSummaryCompactionEngine({
      config: resolved,
      logger: ownLogger,
      telemetry: resolved.telemetry,
      callLlm,
      sessionEventsProvider,
    })
    replaceCompactionProvider(scope, engineImpl, ownLogger)
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
): Promise<PostToolDecision> {
  const payload = { exec, result }
  const folded = decidePostTool(payload, {
    config: resolved,
    telemetry: resolved.telemetry,
    rtkStats,
  })
  const upstream = typeof next === 'function' ? await next() : { kind: 'accept' as const }
  if (!folded.folded) return upstream
  if (upstream.kind === 'block') return upstream
  if (upstream.kind === 'accept' && upstream.value !== undefined) return upstream
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

function makeSessionEventsAccessor(scope: CordisScope): (session: AgentLike['session']) => readonly unknown[] {
  const sessions = scope.get('sessions')
  const obj = sessions as Record<string, unknown> | undefined
  if (!obj || typeof obj.get !== 'function') {
    return () => []
  }
  return (session) => {
    const get = obj.get as (id: string) => unknown
    const s = get(session.id)
    if (!s || typeof s !== 'object') return []
    const events = (s as { events?: () => readonly unknown[] }).events
    return typeof events === 'function' ? events.call(s) : []
  }
}

function makeSystemPromptRegistry(
  scope: CordisScope,
): { register: (fn: (sections: unknown) => unknown) => void } | undefined {
  const sp = scope.get('systemPrompt')
  if (!sp || typeof sp !== 'object') return undefined
  if (typeof (sp as { register?: unknown }).register !== 'function') return undefined
  return {
    register: (fn) => {
      ;(sp as { register: (f: typeof fn) => void }).register(fn)
    },
  }
}

function replaceCompactionProvider(
  scope: CordisScope,
  engineImpl: LlmSummaryCompactionEngine,
  logger: Logger,
): void {
  const obj = scope as unknown as {
    registry?: {
      register?: (key: string, value: unknown) => void
      replace?: (key: string, value: unknown) => void
    }
  }
  const registry = obj.registry
  if (!registry) {
    logger.warn('token-saver: replaceBasicCompaction requested but no scope.registry; skipping replacement')
    return
  }
  if (typeof registry.replace === 'function') {
    registry.replace('compaction', engineImpl)
  } else if (typeof registry.register === 'function') {
    registry.register('compaction', engineImpl)
  }
  logger.warn('token-saver: replaceBasicCompaction=true is in effect; dsh-compaction-basic has been replaced.')
}

function makeLlmCaller(
  _resolved: ResolvedConfig,
  logger: Logger,
): import('./strategies/llm-summary').LlmSummaryEngineDeps['callLlm'] {
  return async (_input) => {
    logger.warn(
      'token-saver: LLM-summary called without an explicit callLlm provider; returning empty summary. Provide one via plugin apply options in dsh harness home.',
    )
    return { summary: [], shadowedTokenCount: 0 }
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

export const plugin = {
  name,
  Config,
  inject,
  apply,
}

export default plugin

export { DEFAULT_COMPACTION_PROMPT, LlmSummaryCompactionEngine }
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
