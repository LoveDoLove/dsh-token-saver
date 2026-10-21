/**
 * Prompt Shaping injection and idempotency across all DSH request wires.
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Supports:
 * - OpenAI Chat wire (`messages` with role='system' | 'developer')
 * - Anthropic Messages wire (`system` field as string or block array)
 * - OpenAI Responses wire (`instructions` or `input` system message)
 * - DSH RequestMessage native options
 *
 * Checks for both dsh-token-saver and ofm-token-saver markers to avoid duplicate shaping.
 */
export declare const DSH_INJECT_MARKER = "<!-- dsh-token-saver:prompt-shaping -->";
export declare const DSH_MARKER_END = "<!-- /dsh-token-saver:prompt-shaping -->";
export declare const OFM_INJECT_MARKER = "<!-- ofm-token-saver -->";
export declare const OFM_MARKER_END = "<!-- /ofm-token-saver -->";
export declare function hasAnyPromptShaping(text: string | undefined): boolean;
export declare function wrapPromptSegment(text: string): string;
export interface InjectionResult {
    readonly text?: string;
    readonly payload?: unknown;
    readonly injected: boolean;
    readonly reason: 'created' | 'appended' | 'already-injected' | 'empty-text' | 'shape-not-recognised';
}
export declare function injectIntoSystemPrompt(currentSystem: string | undefined, textToInject: string): {
    text: string;
    injected: boolean;
    reason: 'created' | 'appended' | 'already-injected' | 'empty-text';
};
/**
 * Remove every injected prompt region from a plain string.
 *
 * Upstream (`dsh-our-free-model`) removes the marked region together with ONE
 * adjacent separator, so removing a segment from the middle of a prompt does
 * not leave a double blank line behind.
 */
export declare function stripPromptShaping(text: string): string;
/**
 * Check if the payload already contains injected prompt shaping across supported wires.
 */
export declare function hasInjected(payload: unknown, wire?: string): boolean;
/**
 * Universal system prompt injector across wire formats.
 *
 * Behaviour follows upstream `dsh-our-free-model`:
 * - the Anthropic `messages` wire inserts the segment BEFORE the last
 *   `cache_control` block, so the provider cache breakpoint stays last and the
 *   whole system prompt remains cache-eligible;
 * - the chat wire extends `messages[0]` when it is a system turn;
 * - the Responses wire prefers `instructions`, and otherwise extends (or
 *   creates) a system message inside `input`.
 */
export declare function injectSystem(payload: unknown, wire: string | undefined, text: string): {
    payload: unknown;
    injected: boolean;
    reason: InjectionResult['reason'];
};
/**
 * Remove injected prompt segments from payload.
 *
 * Covers every shape `injectSystem` can write: Anthropic `system` (string or
 * block array), chat `messages` (string or block content), and the Responses
 * `instructions` string plus system messages inside `input`. Blocks and
 * messages that become empty are removed, as upstream does.
 */
export declare function stripInjected(payload: unknown, _wire?: string): {
    payload: unknown;
    stripped: boolean;
    reason: string;
};
