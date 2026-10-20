/**
 * Cumulative RTK savings telemetry, persisted separately from user settings.
 *
 * The in-memory `RtkStats` accumulator is per-process and per-session; this
 * store keeps the historical totals in ~/.dsh/token-saver/stats.json so the Web
 * dashboard still reports savings after a host restart.
 *
 * Callers hand in per-invocation stats (the shared accumulator is never
 * recorded directly), so each compression pass is counted exactly once. A pass
 * that compresses nothing records nothing. Because the same tool output can be
 * compacted twice — once by tools/post-execute and again by llm/stream on the
 * already-compacted text — `calls` counts compaction events, `blocks` counts
 * compacted text blocks, and `saved` stays exact since per-pass savings add up
 * to the total reduction. Every read and write is fail-open: broken telemetry
 * must never affect compression behaviour or throw into a request path.
 */
import { type TotalSavings } from './settings.js';
import type { RtkStats } from './rtk/index.js';
export declare function emptyTotals(): TotalSavings;
export declare function resolveStatsPath(): string;
export declare class StatsStore {
    private readonly filePath;
    private totals;
    constructor(customPath?: string);
    getFilePath(): string;
    get(): TotalSavings;
    /**
     * Fold one invocation's stats into the cumulative totals.
     *
     * `blocks` counts compressed text blocks while `calls` counts the
     * invocations that produced at least one of them: one request compacting
     * three blocks advances `calls` by one and `blocks` by three. An
     * invocation without a hit records nothing and never touches the file.
     */
    record(stats: RtkStats | null | undefined): TotalSavings;
    private load;
    private save;
}
