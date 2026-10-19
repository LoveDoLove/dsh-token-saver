import { resolveConfig, TokenSaverSchema, DEFAULTS } from './config.js';
import type { TokenSaverConfig } from './internal.js';
import { LlmSummaryCompactionEngine, DEFAULT_COMPACTION_PROMPT } from './strategies/llm-summary.js';
export interface TokenSaverPluginOptions {
    readonly config?: TokenSaverConfig;
    readonly name?: string;
    readonly logger?: Logger;
}
export declare const name = "dsh-token-saver";
export declare const Config: import("./config.js").ConfigDescriptor;
export declare const inject: readonly ["agentLoop", "compaction", "tokenMeter", "systemPrompt", "tools"];
export interface Logger {
    debug: (msg: string, ...rest: readonly unknown[]) => void;
    info: (msg: string, ...rest: readonly unknown[]) => void;
    warn: (msg: string, ...rest: readonly unknown[]) => void;
    error: (msg: string, ...rest: readonly unknown[]) => void;
}
export interface CordisScope {
    on(event: string, listener: (...args: readonly unknown[]) => unknown, options?: unknown): void;
    effect(disposer: () => void): void;
    get(key: string): unknown;
    effectDispose(): void;
}
export declare function apply(rawScope: unknown, rawConfig: unknown): Promise<void>;
export declare const plugin: {
    name: string;
    Config: import("./config.js").ConfigDescriptor;
    inject: readonly ["agentLoop", "compaction", "tokenMeter", "systemPrompt", "tools"];
    apply: typeof apply;
};
export default plugin;
export { DEFAULT_COMPACTION_PROMPT, LlmSummaryCompactionEngine };
export { decidePostTool } from './strategies/tool-result-trim.js';
export { decidePreStep } from './strategies/context-pressure.js';
export { stabilizeForCache } from './strategies/prompt-cache.js';
export { resolveConfig, TokenSaverSchema, DEFAULTS };
export * from './rtk/index.js';
export * from './prompt-shaping/index.js';
export * from './local-responses/index.js';
export type { ResolvedConfig, TokenSaverConfig } from './internal.js';
export type { ToolContentBlock, ToolResultLike, ToolExecutionLike } from './types.js';
