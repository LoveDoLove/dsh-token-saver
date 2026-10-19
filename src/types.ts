export type SessionMode = 'off' | 'conservative' | 'balanced' | 'aggressive'

export type CavemanLevel =
  | 'off'
  | 'lite'
  | 'full'
  | 'ultra'
  | 'wenyan-lite'
  | 'wenyan'
  | 'wenyan-ultra'

export type PonytailLevel = 'off' | 'lite' | 'full' | 'ultra'

export type LocalOptimizationKind = 'quota' | 'prefix' | 'title' | 'suggestion' | 'filepath'

export interface TruncatedText {
  readonly text: string
  readonly strategy: 'head-tail' | 'head-only' | 'tail-only' | 'unchanged'
  readonly originalBytes: number
  readonly trimmedBytes: number
  readonly omittedBytes: number
  readonly headBytesKept: number
  readonly tailBytesKept: number
}

export interface FoldResult {
  readonly content: string
  readonly folded: boolean
  readonly originalBytes: number
  readonly trimmedBytes: number
  readonly savedBytes: number
  readonly matchCount?: number
  readonly truncatedMatches?: number
  readonly strategy: TruncatedText['strategy'] | 'rtk'
  readonly rtkFilter?: string
}

export interface FoldEvent {
  readonly toolName: string | undefined
  readonly originalBytes: number
  readonly trimmedBytes: number
  readonly savedBytes: number
  readonly strategy: TruncatedText['strategy'] | 'rtk'
  readonly rtkFilter?: string
}

export interface CompactEvent {
  readonly trigger: 'pressure' | 'manual' | 'overflow' | 'in-step'
  readonly originalTokens: number
  readonly summaryTokens: number
  readonly savedTokens: number
  readonly engine: 'official-basic' | 'llm-summary' | 'inline-summary'
}

export interface LocalResponseEvent {
  readonly kind: LocalOptimizationKind
  readonly model?: string
  readonly promptTokensEstimate?: number
  readonly savedTokensEstimate?: number
}

export interface TelemetryHook {
  onFold?: (event: FoldEvent) => void
  onCompact?: (event: CompactEvent) => void
  onLocalResponse?: (event: LocalResponseEvent) => void
}

export interface TokenSaverConfig {
  readonly mode?: SessionMode
  readonly preserveStructure?: boolean
  readonly headBytes?: number
  readonly tailBytes?: number
  readonly grepMaxMatches?: number
  readonly grepContextLines?: number
  readonly grepHeadBytes?: number
  readonly grepTailBytes?: number
  readonly pressureThreshold?: number
  readonly compactPressureThreshold?: number
  readonly llmSummaryEnabled?: boolean
  readonly llmSummaryPrompt?: string
  readonly llmSummaryMaxInputTokens?: number
  readonly replaceBasicCompaction?: boolean
  readonly includeToolNames?: readonly string[]
  readonly excludeToolNames?: readonly string[]
  readonly cacheStableSections?: readonly string[]
  readonly telemetry?: TelemetryHook

  // Global token saving features:
  readonly rtkEnabled?: boolean
  readonly cavemanLevel?: CavemanLevel
  readonly ponytailLevel?: PonytailLevel
  readonly localResponsesEnabled?: boolean
  readonly localResponses?:
    | readonly LocalOptimizationKind[]
    | Partial<Record<LocalOptimizationKind, boolean>>
}

export interface Logger {
  debug: (msg: string, ...rest: readonly unknown[]) => void
  info: (msg: string, ...rest: readonly unknown[]) => void
  warn: (msg: string, ...rest: readonly unknown[]) => void
  error: (msg: string, ...rest: readonly unknown[]) => void
}

export interface ToolContentBlock {
  readonly type: string
  readonly text?: string
  readonly data?: unknown
}

export interface ToolExecutionLike {
  readonly id: string
  readonly tool: { readonly name: string }
}

export interface ToolResultLike {
  readonly content?: readonly ToolContentBlock[]
  readonly value?: unknown
  readonly isError?: boolean
}

export interface PostToolDecision {
  readonly kind: 'accept' | 'block'
  readonly content?: readonly ToolContentBlock[]
  readonly value?: unknown
  readonly feedback?: readonly ToolContentBlock[]
  readonly additionalContexts?: readonly unknown[]
}

export interface PreStepPayloadLike {
  readonly agent: { readonly session: { readonly id: string } }
  readonly messages: readonly unknown[]
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

export interface PreStepDecisionLike {
  readonly kind: 'reject' | 'enter'
  readonly messages?: readonly unknown[]
  readonly startsRequestSeries?: boolean
}

export interface SessionLike {
  readonly id: string
  readonly deriveMessages?: () => readonly unknown[]
}

export interface AgentLike {
  readonly session: SessionLike
  readonly options?: { readonly provider?: string; readonly model?: string }
}

export interface CompactionEngineLike {
  compactIfNeeded: (
    agent: AgentLike,
    trigger: 'pressure' | 'context-overflow',
    signal: AbortSignal,
  ) => Promise<unknown>
  compactNow: (
    agent: AgentLike & { runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T> },
    signal: AbortSignal,
    sourceCommandId?: string,
  ) => Promise<unknown>
  compactRegion: (
    start: number,
    end: number,
    agent: AgentLike,
    signal?: AbortSignal,
  ) => Promise<unknown>
}

export interface TokenMeterLike {
  readonly current: number
  readonly capacity: number
  readonly pressure: number
}

export interface SystemPromptSection {
  readonly id: string
  readonly content: readonly string[]
  readonly position: number
  readonly cacheable: boolean
}

export interface CordisScope {
  on(event: string, listener: (...args: readonly any[]) => any, options?: { global?: boolean; prepend?: boolean }): void
  effect(disposer: () => void): void
  get(key: string): unknown
  effectDispose?(): void
}

export interface GenerateOptionsLike {
  provider?: string
  model?: string
  system?: string
  messages?: readonly any[]
  tools?: readonly any[]
  purpose?: string
  sessionId?: string
  [key: string]: unknown
}

export interface StreamChunkLike {
  type: string
  [key: string]: unknown
}

