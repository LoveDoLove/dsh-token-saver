/**
 * Context pressure strategy: triggers compaction before the next step
 * when token usage crosses the configured threshold.
 * Ported from refs/dsh-token-saver under MIT license.
 */
import type { CompactionEngineLike, Logger, PreStepDecisionLike, PreStepPayloadLike, ResolvedConfig, TelemetryHook, TokenMeterLike } from '../internal.js';
export interface ContextPressureOptions {
    readonly config: ResolvedConfig;
    readonly telemetry?: TelemetryHook;
    readonly logger?: Logger;
    readonly getTokenMeter?: (sessionId: string) => TokenMeterLike | undefined;
    readonly getCompactionEngine?: () => CompactionEngineLike | undefined;
    readonly agentForSession?: (sessionId: string) => unknown;
}
export interface ContextPressureDecision {
    readonly action: 'skip' | 'rely-on-official' | 'compact-region' | 'compact-now';
    readonly pressure: number;
    readonly compactedBeforeStep: boolean;
}
export declare function decidePreStep(payload: PreStepPayloadLike, options: ContextPressureOptions, next: () => Promise<PreStepDecisionLike>): Promise<PreStepDecisionLike>;
declare function estimateSummaryTokens(result: unknown): number;
export declare const __testing: {
    estimateSummaryTokens: typeof estimateSummaryTokens;
};
export {};
