export interface TruncateOptions {
    readonly headBytes?: number;
    readonly tailBytes?: number;
    readonly preserveStructure?: boolean;
    readonly separator?: string;
}
export interface TruncateResult {
    readonly content: string;
    readonly folded: boolean;
    readonly originalBytes: number;
    readonly trimmedBytes: number;
    readonly headBytesKept: number;
    readonly tailBytesKept: number;
    readonly omittedBytes: number;
    readonly strategy: 'head-tail' | 'head-only' | 'tail-only' | 'unchanged';
}
export declare function truncate(input: string, options?: TruncateOptions): TruncateResult;
export declare function truncateHead(input: string, maxBytes: number, options?: TruncateOptions): TruncateResult;
export declare function truncateTail(input: string, maxBytes: number, options?: TruncateOptions): TruncateResult;
declare function byteLength(input: string): number;
declare function sliceByBytes(input: string, byteStart: number, byteEnd: number): {
    text: string;
    bytes: number;
};
declare function breakAtLineBoundary(input: string, byteStart: number, byteEnd: number, direction: 'forward' | 'backward'): {
    text: string;
    bytes: number;
};
declare function formatBytes(bytes: number): string;
export declare const __testing: {
    byteLength: typeof byteLength;
    sliceByBytes: typeof sliceByBytes;
    breakAtLineBoundary: typeof breakAtLineBoundary;
    formatBytes: typeof formatBytes;
};
export {};
