export const DEFAULTS = Object.freeze({
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
    includeToolNames: [],
    excludeToolNames: [],
    cacheStableSections: [],
    telemetry: undefined,
    // Global token saving features — all OFF by default (preserve existing defaults).
    rtkEnabled: false,
    cavemanLevel: 'off',
    ponytailLevel: 'off',
    localResponsesEnabled: false,
    localResponses: new Set(['quota', 'prefix', 'title', 'suggestion', 'filepath']),
});
const ALL_LOCAL_OPTIMIZATIONS = ['quota', 'prefix', 'title', 'suggestion', 'filepath'];
const VALID_MODES = ['off', 'conservative', 'balanced', 'aggressive'];
const VALID_CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra'];
const VALID_PONYTAIL_LEVELS = ['off', 'lite', 'full', 'ultra'];
const VALID_LOCAL_KINDS = ['quota', 'prefix', 'title', 'suggestion', 'filepath'];
function pickEnum(value, valid, fallback) {
    return typeof value === 'string' && valid.includes(value) ? value : fallback;
}
function resolveLocalResponses(cfg, enabled) {
    const raw = cfg.localResponses;
    if (raw === undefined)
        return new Set(ALL_LOCAL_OPTIMIZATIONS);
    let kinds;
    if (Array.isArray(raw)) {
        kinds = raw.filter((k) => VALID_LOCAL_KINDS.includes(k));
    }
    else if (raw && typeof raw === 'object') {
        kinds = ALL_LOCAL_OPTIMIZATIONS.filter((k) => raw[k] !== false);
    }
    else {
        kinds = ALL_LOCAL_OPTIMIZATIONS;
    }
    return enabled ? new Set(kinds) : new Set();
}
export function resolveConfig(input) {
    const cfg = input ?? {};
    const mode = pickEnum(cfg.mode, VALID_MODES, DEFAULTS.mode);
    const llmSummaryEnabled = cfg.llmSummaryEnabled === true && (mode === 'balanced' || mode === 'aggressive');
    const rtkEnabled = cfg.rtkEnabled === true;
    const localResponsesEnabled = cfg.localResponsesEnabled === true;
    const localResponses = resolveLocalResponses(cfg, localResponsesEnabled);
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
    };
}
export const TokenSaverSchema = {
    '~standard': {
        version: 1,
        vendor: 'dsh-token-saver',
        validate(input) {
            if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
                return {
                    issues: [
                        {
                            message: 'Expected configuration to be an object',
                        },
                    ],
                };
            }
            const validated = (!input || typeof input !== 'object') ? {} : input;
            return { value: validated };
        },
    },
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
        if (!input || typeof input !== 'object')
            return {};
        return input;
    },
    resolve: resolveConfig,
};
