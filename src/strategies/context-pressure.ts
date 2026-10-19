/**
 * Context pressure strategy: triggers compaction before the next step
 * when token usage crosses the configured threshold.
 * Ported from refs/dsh-token-saver under MIT license.
 */

import type {
  CompactionEngineLike,
  Logger,
  PreStepDecisionLike,
  PreStepPayloadLike,
  ResolvedConfig,
  TelemetryHook,
  TokenMeterLike,
} from '../internal.js'

export interface ContextPressureOptions {
  readonly config: ResolvedConfig
  readonly telemetry?: TelemetryHook
  readonly logger?: Logger
  readonly getTokenMeter?: (sessionId: string) => TokenMeterLike | undefined
  readonly getCompactionEngine?: () => CompactionEngineLike | undefined
  readonly agentForSession?: (sessionId: string) => unknown
}

export interface ContextPressureDecision {
  readonly action: 'skip' | 'rely-on-official' | 'compact-region' | 'compact-now'
  readonly pressure: number
  readonly compactedBeforeStep: boolean
}

export async function decidePreStep(
  payload: PreStepPayloadLike,
  options: ContextPressureOptions,
  next: () => Promise<PreStepDecisionLike>,
): Promise<PreStepDecisionLike> {
  const cfg = options.config
  if (cfg.mode === 'off') {
    return next()
  }
  const sessionId = payload.agent?.session?.id
  if (!sessionId) {
    return next()
  }
  const meter = options.getTokenMeter?.(sessionId)
  const pressure = meter ? meter.pressure : 0
  const nextDecision = await next()
  if (nextDecision.kind === 'reject') {
    return nextDecision
  }
  if (cfg.mode === 'conservative' && !cfg.llmSummaryEnabled) {
    return nextDecision
  }
  if (pressure < cfg.pressureThreshold) {
    return nextDecision
  }
  const agent = options.agentForSession?.(sessionId) as Parameters<CompactionEngineLike['compactIfNeeded']>[0] | undefined
  const engine = options.getCompactionEngine?.()
  if (!agent || !engine) {
    options.logger?.warn('token-saver: pressure exceeded but compaction engine unavailable; skipping')
    return nextDecision
  }
  try {
    const result = await engine.compactIfNeeded(agent, 'pressure', payload.signal)
    if (result) {
      if (options.telemetry?.onCompact) {
        const summaryTokens = estimateSummaryTokens(result)
        const capacity = meter?.capacity ?? 0
        const originalTokens = Math.max(1, Math.round(capacity * pressure))
        options.telemetry.onCompact({
          trigger: 'pressure',
          originalTokens,
          summaryTokens,
          savedTokens: Math.max(0, originalTokens - summaryTokens),
          engine: 'official-basic',
        })
      }
    }
    return nextDecision
  } catch (err) {
    options.logger?.warn(`token-saver: compactIfNeeded failed: ${(err as Error).message}`)
    return nextDecision
  }
}

function estimateSummaryTokens(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  const tokens = (result as { shadowedTokenCount?: unknown }).shadowedTokenCount
  if (typeof tokens === 'number') return tokens
  return 0
}

export const __testing = { estimateSummaryTokens }
