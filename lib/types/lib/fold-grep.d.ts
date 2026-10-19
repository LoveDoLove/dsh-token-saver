export interface GrepFoldOptions {
    readonly pattern?: string;
    readonly grepContextLines?: number;
    readonly grepMaxMatches?: number;
    readonly grepHeadBytes?: number;
    readonly grepTailBytes?: number;
    readonly foldNonMatching?: boolean;
}
export interface GrepFoldResult {
    readonly content: string;
    readonly folded: boolean;
    readonly matchCount: number;
    readonly truncatedMatches: number;
    readonly originalBytes: number;
    readonly trimmedBytes: number;
}
export declare function foldGrepResult(input: string, options?: GrepFoldOptions): GrepFoldResult;
