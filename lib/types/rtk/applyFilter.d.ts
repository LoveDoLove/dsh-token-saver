/**
 * Safe filter runner: wrap filter execution so any thrown error or invalid
 * return value fails open (returns original text unmodified).
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
export type RtkFilterFn = ((text: string, ...args: any[]) => string) & {
    filterName?: string;
};
export declare function safeApply(fn: RtkFilterFn, text: string): string;
