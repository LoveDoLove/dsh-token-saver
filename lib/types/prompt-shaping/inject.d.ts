/**
 * Prompt Shaping injection and idempotency.
 * Supports DSH native system prompt assembly as well as llm/stream options fallback.
 * Checks for both dsh-token-saver and ofm-token-saver markers to avoid duplicate shaping.
 */
export declare const DSH_INJECT_MARKER = "<!-- dsh-token-saver:prompt-shaping -->";
export declare const DSH_MARKER_END = "<!-- /dsh-token-saver:prompt-shaping -->";
export declare const OFM_INJECT_MARKER = "<!-- ofm-token-saver -->";
export declare const OFM_MARKER_END = "<!-- /ofm-token-saver -->";
export declare function hasAnyPromptShaping(text: string | undefined): boolean;
export declare function wrapPromptSegment(text: string): string;
export interface InjectionResult {
    readonly text: string;
    readonly injected: boolean;
    readonly reason: 'created' | 'appended' | 'already-injected' | 'empty-text';
}
export declare function injectIntoSystemPrompt(currentSystem: string | undefined, textToInject: string): InjectionResult;
export declare function stripPromptShaping(text: string): string;
