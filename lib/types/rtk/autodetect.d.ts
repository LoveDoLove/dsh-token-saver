/**
 * Automatic detector for identifying the appropriate RTK filter to apply.
 * Ported from dsh-our-free-model / open-sse/rtk autodetect under MIT license.
 */
import type { RtkFilterFn } from './applyFilter.js';
export declare function isMostlyPorcelain(sampleLines: readonly string[]): boolean;
export declare function autoDetectFilter(text: string): RtkFilterFn | null;
