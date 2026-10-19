import type {
  CavemanLevel,
  LocalOptimizationKind,
  PonytailLevel,
  SessionMode,
  TokenSaverConfig,
} from './types'

export type { SessionMode, TokenSaverConfig, CavemanLevel, PonytailLevel, LocalOptimizationKind }

export interface ResolvedConfig {
  readonly mode: SessionMode
  readonly preserveStructure: boolean
  readonly headBytes: number
  readonly tailBytes: number
  readonly grepMaxMatches: number
  readonly grepContextLines: number
  readonly grepHeadBytes: number
  readonly grepTailBytes: number
  readonly pressureThreshold: number
  readonly compactPressureThreshold: number
  readonly llmSummaryEnabled: boolean
  readonly llmSummaryPrompt: string
  readonly llmSummaryMaxInputTokens: number
  readonly replaceBasicCompaction: boolean
  readonly includeToolNames: readonly string[]
  readonly excludeToolNames: readonly string[]
  readonly cacheStableSections: readonly string[]
  readonly telemetry: TokenSaverConfig['telemetry']

  // Global token saving features:
  readonly rtkEnabled: boolean
  readonly cavemanLevel: CavemanLevel
  readonly ponytailLevel: PonytailLevel
  readonly localResponsesEnabled: boolean
  readonly localResponses: ReadonlySet<LocalOptimizationKind>
}

export const DEFAULTS: ResolvedConfig = Object.freeze({
  mode: 'conservative',
  preserveStructure: true,
  headBytes: 16 * 1024,
  tailBytes: 8 * 1024,
  grepMaxMatches: 30,
  grepContextLines: 2,
  grepHeadBytes: 8 * 1024,
  grepTailBytes: 4 * 1024,
  pressureThreshold: 0.5,
  compactPressureThreshold: 0.5,
  llmSummaryEnabled: false,
  llmSummaryPrompt: '',
  llmSummaryMaxInputTokens: 16_000,
  replaceBasicCompaction: false,
  includeToolNames: [] as readonly string[],
  excludeToolNames: [] as readonly string[],
  cacheStableSections: [] as readonly string[],
  telemetry: undefined,

  // Global token saving features — all OFF by default (preserve existing defaults).
  rtkEnabled: false,
  cavemanLevel: 'off',
  ponytailLevel: 'off',
  localResponsesEnabled: false,
  localResponses: new Set<LocalOptimizationKind>(['quota', 'prefix', 'title', 'suggestion', 'filepath']),
})

const ALL_LOCAL_OPTIMIZATIONS: readonly LocalOptimizationKind[] = ['quota', 'prefix', 'title', 'suggestion', 'filepath']

const VALID_MODES: readonly SessionMode[] = ['off', 'conservative', 'balanced', 'aggressive']
const VALID_CAVEMAN_LEVELS: readonly CavemanLevel[] = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra']
const VALID_PONYTAIL_LEVELS: readonly PonytailLevel[] = ['off', 'lite', 'full', 'ultra']
const VALID_LOCAL_KINDS: readonly LocalOptimizationKind[] = ['quota', 'prefix', 'title', 'suggestion', 'filepath']

function pickEnum<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value) ? (value as T) : fallback
}

function resolveLocalResponses(cfg: TokenSaverConfig, enabled: boolean): ReadonlySet<LocalOptimizationKind> {
  const raw = cfg.localResponses
  if (raw === undefined) return new Set(ALL_LOCAL_OPTIMIZATIONS)
  let kinds: readonly LocalOptimizationKind[]
  if (Array.isArray(raw)) {
    kinds = raw.filter((k): k is LocalOptimizationKind => VALID_LOCAL_KINDS.includes(k as LocalOptimizationKind))
  } else if (raw && typeof raw === 'object') {
    kinds = ALL_LOCAL_OPTIMIZATIONS.filter((k) => (raw as Record<string, unknown>)[k] !== false)
  } else {
    kinds = ALL_LOCAL_OPTIMIZATIONS
  }
  return enabled ? new Set(kinds) : new Set<LocalOptimizationKind>()
}

export function resolveConfig(input: TokenSaverConfig | undefined): ResolvedConfig {
  const cfg = input ?? {}
  const mode = pickEnum(cfg.mode, VALID_MODES, DEFAULTS.mode)
  const llmSummaryEnabled = cfg.llmSummaryEnabled === true && (mode === 'balanced' || mode === 'aggressive')

  const rtkEnabled = cfg.rtkEnabled === true
  const localResponsesEnabled = cfg.localResponsesEnabled === true
  const localResponses = resolveLocalResponses(cfg, localResponsesEnabled)

  return {
    mode,
    preserveStructure: cfg.preserveStructure ?? DEFAULTS.preserveStructure,
    headBytes: cfg.headBytes ?? DEFAULTS.headBytes,
    tailBytes: cfg.tailBytes ?? DEFAULTS.tailBytes,
    grepMaxMatches: cfg.grepMaxMatches ?? DEFAULTS.grepMaxMatches,
    grepContextLines: cfg.grepContextLines ?? DEFAULTS.grepContextLines,
    grepHeadBytes: cfg.grepHeadBytes ?? DEFAULTS.grepHeadBytes,
    grepTailBytes: cfg.grepTailBytes ?? DEFAULTS.grepTailBytes,
    pressureThreshold: cfg.pressureThreshold ?? DEFAULTS.pressureThreshold,
    compactPressureThreshold: cfg.compactPressureThreshold ?? DEFAULTS.compactPressureThreshold,
    llmSummaryEnabled,
    llmSummaryPrompt: cfg.llmSummaryPrompt ?? DEFAULTS.llmSummaryPrompt,
    llmSummaryMaxInputTokens: cfg.llmSummaryMaxInputTokens ?? DEFAULTS.llmSummaryMaxInputTokens,
    replaceBasicCompaction: cfg.replaceBasicCompaction ?? (mode === 'aggressive'),
    includeToolNames: cfg.includeToolNames ?? DEFAULTS.includeToolNames,
    excludeToolNames: cfg.excludeToolNames ?? DEFAULTS.excludeToolNames,
    cacheStableSections: cfg.cacheStableSections ?? DEFAULTS.cacheStableSections,
    telemetry: cfg.telemetry,

    rtkEnabled,
    cavemanLevel: pickEnum(cfg.cavemanLevel, VALID_CAVEMAN_LEVELS, DEFAULTS.cavemanLevel),
    ponytailLevel: pickEnum(cfg.ponytailLevel, VALID_PONYTAIL_LEVELS, DEFAULTS.ponytailLevel),
    localResponsesEnabled,
    localResponses,
  }
}

export interface ConfigDescriptor {
  readonly name: string
  readonly fields: Readonly<Record<keyof ResolvedConfig | 'mode', 'string' | 'number' | 'boolean' | 'enum'>>
  readonly validate: (input: unknown) => TokenSaverConfig
  readonly resolve: (input: TokenSaverConfig) => ResolvedConfig
}

export const TokenSaverSchema: ConfigDescriptor = {
  name: 'TokenSaverConfig',
  fields: {
    mode: 'enum',
    preserveStructure: 'boolean',
    headBytes: 'number',
    tailBytes: 'number',
    grepMaxMatches: 'number',
    grepContextLines: 'number',
    grepHeadBytes: 'number',
    grepTailBytes: 'number',
    pressureThreshold: 'number',
    compactPressureThreshold: 'number',
    llmSummaryEnabled: 'boolean',
    llmSummaryPrompt: 'string',
    llmSummaryMaxInputTokens: 'number',
    replaceBasicCompaction: 'boolean',
    includeToolNames: 'string',
    excludeToolNames: 'string',
    cacheStableSections: 'string',
    telemetry: 'string',
    rtkEnabled: 'boolean',
    cavemanLevel: 'enum',
    ponytailLevel: 'enum',
    localResponsesEnabled: 'boolean',
    localResponses: 'string',
  },
  validate(input) {
    if (!input || typeof input !== 'object') return {}
    return input as TokenSaverConfig
  },
  resolve: resolveConfig,
}
