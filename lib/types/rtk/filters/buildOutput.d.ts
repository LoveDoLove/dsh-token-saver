/**
 * Compact build-tool output (npm, yarn, cargo, rustc, maven, gradle, tsc).
 * Build logs are mostly progress; the parts a model can act on are the
 * errors, a bounded number of warnings, and the final summary.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import type { RtkFilterFn } from '../applyFilter.js';
export declare const buildOutput: RtkFilterFn;
