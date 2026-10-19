/**
 * Helper routines for parsing ripgrep/grep/code_search output lines.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
export declare function isGrepHit(line: string): boolean;
export declare function splitGrepHit(line: string): {
    file: string;
    lineNo: string;
    rest: string;
} | null;
export declare function parseGrepOutput(text: string): {
    groups: Map<string, Array<{
        lineNo: string;
        text: string;
        isMatch: boolean;
    }>>;
    totalHits: number;
};
