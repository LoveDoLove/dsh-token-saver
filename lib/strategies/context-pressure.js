/**
 * Context pressure strategy: triggers compaction before the next step
 * when token usage crosses the configured threshold.
 * Ported from refs/dsh-token-saver under MIT license.
 */
export async function decidePreStep(payload, options, next) {
    const cfg = options.config;
    if (cfg.mode === 'off') {
        return next();
    }
    const sessionId = payload.agent?.session?.id;
    if (!sessionId) {
        return next();
    }
    const meter = options.getTokenMeter?.(sessionId);
    const pressure = meter ? meter.pressure : 0;
    const nextDecision = await next();
    if (nextDecision.kind === 'reject') {
        return nextDecision;
    }
    if (cfg.mode === 'conservative' && !cfg.llmSummaryEnabled) {
        return nextDecision;
    }
    if (pressure < cfg.pressureThreshold) {
        return nextDecision;
    }
    const agent = options.agentForSession?.(sessionId);
    const engine = options.getCompactionEngine?.();
    if (!agent || !engine) {
        options.logger?.warn('token-saver: pressure exceeded but compaction engine unavailable; skipping');
        return nextDecision;
    }
    try {
        const result = await engine.compactIfNeeded(agent, 'pressure', payload.signal);
        if (result) {
            if (options.telemetry?.onCompact) {
                const summaryTokens = estimateSummaryTokens(result);
                const capacity = meter?.capacity ?? 0;
                const originalTokens = Math.max(1, Math.round(capacity * pressure));
                options.telemetry.onCompact({
                    trigger: 'pressure',
                    originalTokens,
                    summaryTokens,
                    savedTokens: Math.max(0, originalTokens - summaryTokens),
                    engine: 'official-basic',
                });
            }
        }
        return nextDecision;
    }
    catch (err) {
        options.logger?.warn(`token-saver: compactIfNeeded failed: ${err.message}`);
        return nextDecision;
    }
}
function estimateSummaryTokens(result) {
    if (!result || typeof result !== 'object')
        return 0;
    const tokens = result.shadowedTokenCount;
    if (typeof tokens === 'number')
        return tokens;
    return 0;
}
export const __testing = { estimateSummaryTokens };
