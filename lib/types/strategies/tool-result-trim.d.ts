/**
 * Tool result trimming strategy: head/tail truncation, grep folding, plus the
 * RTK filter engine for structured CLI output (git diff/status/log, grep,
 * find, ls, tree, build output, logs).
 *
 * Base head/tail truncation ported from refs/dsh-token-saver (MIT).
 * RTK filters ported from dsh-our-free-model / open-sse/rtk (MIT).
 *
 * Fail-open contract: any error inside trimming falls back to `accept`
 * with the original content preserved verbatim.
 */
import { type RtkStats } from '../rtk/index.js';
import type { PostToolDecision, ResolvedConfig, TelemetryHook, ToolContentBlock, ToolExecutionLike, ToolResultLike } from '../internal.js';
export interface ToolResultTrimOptions {
    readonly config: ResolvedConfig;
    readonly telemetry?: TelemetryHook;
    readonly rtkStats?: RtkStats;
}
export interface ToolResultTrimResult {
    readonly decision: PostToolDecision;
    readonly folded: boolean;
    readonly originalBytes: number;
    readonly trimmedBytes: number;
}
export declare function shouldHandle(toolName: string | undefined, cfg: ResolvedConfig): boolean;
export interface PostToolPayloadLike {
    readonly exec?: ToolExecutionLike;
    readonly result?: ToolResultLike;
}
export declare function decidePostTool(payload: PostToolPayloadLike, options: ToolResultTrimOptions): ToolResultTrimResult;
interface AggregateText {
    readonly text: string;
    readonly segments: readonly {
        readonly start: number;
        readonly end: number;
    }[];
}
declare function aggregateText(content: readonly ToolContentBlock[]): AggregateText;
declare function rebuildContent(content: readonly ToolContentBlock[], segments: readonly {
    start: number;
    end: number;
}[], newText: string, originalText: string): readonly ToolContentBlock[];
export declare const __testing: {
    aggregateText: typeof aggregateText;
    rebuildContent: typeof rebuildContent;
    GREP_LIKE_TOOLS: Set<string>;
    READ_LIKE_TOOLS: Set<string>;
    TOOL_RTK_FILTERS: Readonly<Record<string, string>>;
};
export {};
