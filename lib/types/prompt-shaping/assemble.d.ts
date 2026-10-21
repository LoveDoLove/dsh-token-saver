/**
 * Prompt Shaping through the DSH `system-prompt/assemble` waterfall.
 *
 * Why this exists: the agent loop deep-freezes the request it hands to
 * `llm/stream` (`dsh-agent-loop` `buildRequest` → `deepFreeze(header)`,
 * `deepFreeze(message)`, `Object.freeze(boundaryMessages)`), so an
 * `llm/stream` listener can never mutate the system prompt in place — the
 * in-place `injectSystem(req, …)` call was a silent no-op on the real agent
 * path, and Caveman/Ponytail never reached the model.
 *
 * DSH builds the model-facing system prompt from ordered sections
 * (`dsh-system-prompt` `assemble()`); `renderPrompt()` joins only
 * `assembly.sections`. The `system-prompt/assemble` waterfall is
 * cooperative: the RETURNED assembly is authoritative, and a listener that
 * calls `next()` first and then extends the returned assembly is the
 * canonical pattern (used by `dsh-working-directory` and `dsh-agent`).
 *
 * Known DSH limitation: when another plugin registers a `complete` prompt
 * section, DSH restores that section as the SOLE section after the
 * waterfall, discarding any section added here. A deployment that owns the
 * whole system prompt owns the shaping prompt too; this plugin then stays
 * silent rather than fighting over the prompt.
 */
/** The section name this plugin contributes. */
export declare const SHAPING_SECTION_NAME = "token-saver:prompt-shaping";
/** The minimal shape of a rendered prompt section we rely on. */
export interface PromptSectionLike {
    readonly name: string;
    readonly text: string;
    readonly interpolate?: boolean;
}
/** The minimal shape of a DSH prompt assembly. */
export interface PromptAssemblyLike {
    readonly sections: readonly PromptSectionLike[];
    readonly contexts?: readonly unknown[];
    readonly tools?: readonly unknown[];
    readonly variables?: Record<string, unknown>;
}
/** The `system-prompt/assemble` listener signature used by DSH. */
export type AssembleListener = (assembly: PromptAssemblyLike, context: unknown, next: () => Promise<PromptAssemblyLike>) => Promise<PromptAssemblyLike>;
/**
 * Build the `system-prompt/assemble` listener that injects the shaping
 * prompt.
 *
 * The prompt text is resolved on every assembly, so a settings change takes
 * effect on the next model step without reloading the plugin.
 *
 * The listener never vetoes the chain: it awaits `next()` first and returns
 * the transformed assembly, so other listeners (tools, contexts, variables)
 * still run. Any failure degrades to "no shaping", never to a broken step.
 */
export declare function createAssembleInjector(getPromptText: () => string): AssembleListener;
