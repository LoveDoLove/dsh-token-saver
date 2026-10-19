/**
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Global Token Saving pipeline for DSH requests across all wires and models.
 */
import { type RtkStats } from '../rtk/compress.js';
import type { ResolvedConfig } from '../config.js';
export interface TokenSaverPromptReport {
    injected: boolean;
    reason: string;
    families: string[];
}
export interface TokenSaverReport {
    prompt: TokenSaverPromptReport | null;
    rtk: RtkStats | null;
    saved: number;
    bytesBefore: number;
    bytesAfter: number;
    notes: string[];
}
export interface TokenSaverTotals {
    bytesBefore: number;
    bytesAfter: number;
    saved: number;
    blocks: number;
    calls: number;
    promptCalls: number;
}
export declare function emptySavings(): TokenSaverTotals;
export declare function addSavings(total: TokenSaverTotals | null | undefined, report: TokenSaverReport | null | undefined): TokenSaverTotals;
export declare function savingsPercent(total: TokenSaverTotals | null | undefined): number;
export declare function describeSavingsTotal(total: TokenSaverTotals | null | undefined): string;
/**
 * Apply the full token-saving pipeline to an outbound request payload across any wire.
 * 1. Prompt shaping (terse response / minimal code instructions)
 * 2. RTK tool-output compaction (smart filters over git diff, logs, find, ls, grep)
 */
export declare function applyTokenSavers(payload: unknown, wire: string | undefined, config: Partial<ResolvedConfig> | Record<string, unknown> | undefined): TokenSaverReport;
