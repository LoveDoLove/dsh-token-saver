/**
 * Compact line-numbered file reading output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import type { RtkFilterFn } from '../applyFilter.js';
export declare function isNumberedOutput(lines: readonly string[]): boolean;
export declare const readNumbered: RtkFilterFn;
