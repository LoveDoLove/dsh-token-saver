/**
 * RTK (Rust Token Killer) optimization engine for tool results.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Core invariant:
 * - Only tool output is compacted (never system, user, or assistant text).
 * - Error results are NEVER compacted (preserved verbatim).
 * - Replacement only occurs when replacement is non-empty AND strictly smaller.
 * - Any filter failure fails open (original text preserved).
 */
export interface RtkHit {
    readonly filter: string;
    readonly originalBytes: number;
    readonly compactedBytes: number;
    readonly savedBytes: number;
}
export interface RtkStats {
    bytesBefore: number;
    bytesAfter: number;
    saved: number;
    hits: RtkHit[];
}
export declare function createRtkStats(): RtkStats;
export interface CompressTextResult {
    readonly text: string;
    readonly filterUsed: string | null;
    readonly savedBytes: number;
    readonly compressed: boolean;
}
export declare function compressText(text: string, stats?: RtkStats, explicitFilterName?: string): CompressTextResult;
export declare function formatRtkLog(stats: RtkStats): string | null;
export * from './constants.js';
export * from './applyFilter.js';
export * from './hitLine.js';
export * from './autodetect.js';
export * from './registry.js';
export * from './filters/gitDiff.js';
export * from './filters/gitStatus.js';
export * from './filters/gitLog.js';
export * from './filters/grep.js';
export * from './filters/find.js';
export * from './filters/ls.js';
export * from './filters/tree.js';
export * from './filters/dedupLog.js';
export * from './filters/smartTruncate.js';
export * from './filters/readNumbered.js';
export * from './filters/searchList.js';
export * from './filters/buildOutput.js';
