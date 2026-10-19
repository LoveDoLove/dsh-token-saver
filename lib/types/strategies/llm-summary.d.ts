/**
 * LLM-summary compaction strategy.
 * Ported from refs/dsh-token-saver under MIT license.
 */
import type { AgentLike, CompactionEngineLike, Logger, ResolvedConfig, TelemetryHook } from '../internal.js';
export interface LlmSummaryEngineDeps {
    readonly config: ResolvedConfig;
    readonly logger?: Logger;
    readonly telemetry?: TelemetryHook;
    readonly callLlm: (input: LlmSummaryInput) => Promise<LlmSummaryOutput>;
    readonly sessionEventsProvider?: (session: AgentLike['session']) => readonly unknown[];
}
export interface LlmSummaryInput {
    readonly sessionId: string;
    readonly messages: readonly unknown[];
    readonly maxInputTokens: number;
    readonly customPrompt: string;
    readonly signal: AbortSignal;
}
export interface LlmSummaryOutput {
    readonly summary: readonly {
        readonly type: string;
        readonly text?: string;
    }[];
    readonly shadowedTokenCount: number;
    readonly usage?: {
        readonly inputTokens: number;
        readonly outputTokens: number;
    };
}
export interface LlmSummaryCompactionResult {
    readonly status: 'skipped' | 'succeeded' | 'failed';
    readonly reason?: string;
    readonly summary?: LlmSummaryOutput;
}
export declare class LlmSummaryCompactionEngine implements CompactionEngineLike {
    #private;
    constructor(deps: LlmSummaryEngineDeps);
    compactIfNeeded(agent: AgentLike, trigger: 'pressure' | 'context-overflow', signal: AbortSignal): Promise<LlmSummaryCompactionResult>;
    compactNow(agent: AgentLike & {
        runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
    }, signal: AbortSignal, _sourceCommandId?: string): Promise<LlmSummaryCompactionResult>;
    compactRegion(_start: number, _end: number, agent: AgentLike, signal?: AbortSignal): Promise<LlmSummaryCompactionResult>;
}
export declare function estimateTokens(events: readonly unknown[]): number;
export declare const DEFAULT_COMPACTION_PROMPT: string;
