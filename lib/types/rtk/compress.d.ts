/**
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Wire message compression engine for DSH outbound LLM requests.
 */
import { type RtkStats } from './index.js';
export type { RtkStats };
export interface CompressOptions {
    enabled?: boolean;
    wire?: string;
}
export interface CompressRequestResult {
    payload: unknown;
    stats: RtkStats;
}
/**
 * Walk wire messages across diverse LLM protocol formats and compress tool outputs in-place.
 * Preserves error blocks, user messages, and non-tool payload components verbatim.
 */
export declare function compressMessages(body: unknown, options?: CompressOptions | boolean | string, _legacyInPlace?: boolean): RtkStats | null;
/**
 * Universal wrapper for compressing any request payload across all DSH request wires.
 */
export declare function compressRequest(payload: unknown, wire?: string, enabled?: boolean): CompressRequestResult;
/**
 * Generate human-readable summary of RTK savings.
 */
export declare function describeSavings(stats: RtkStats | null | undefined): string | null;
