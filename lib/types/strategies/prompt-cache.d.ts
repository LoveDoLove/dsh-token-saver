/**
 * Prompt-cache strategy: stabilizes system prompt sections for prefix caching.
 * Ported from refs/dsh-token-saver under MIT license.
 */
import type { ResolvedConfig, SystemPromptSection } from '../internal.js';
export interface StableLayoutInput {
    readonly sections: readonly SystemPromptSection[];
    readonly config?: Partial<ResolvedConfig>;
}
export interface StableLayoutResult {
    readonly sections: readonly SystemPromptSection[];
    readonly cacheableRatio: number;
    readonly reordered: boolean;
}
export declare function stabilizeForCache(input: StableLayoutInput): StableLayoutResult;
export declare function markCacheable(sections: readonly SystemPromptSection[]): readonly SystemPromptSection[];
export declare const __testing: {
    stabilizeForCache: typeof stabilizeForCache;
};
