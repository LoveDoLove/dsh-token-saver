/**
 * LLM-summary compaction strategy.
 * Ported from refs/dsh-token-saver under MIT license.
 */
export class LlmSummaryCompactionEngine {
    #deps;
    constructor(deps) {
        this.#deps = deps;
    }
    async compactIfNeeded(agent, trigger, signal) {
        if (!this.#deps.config.llmSummaryEnabled) {
            return { status: 'skipped', reason: 'llmSummaryEnabled=false' };
        }
        if (trigger === 'context-overflow') {
            return this.#tryCompact(agent, signal, 'overflow');
        }
        const events = this.#deps.sessionEventsProvider?.(agent.session);
        if (!events || events.length === 0) {
            return { status: 'skipped', reason: 'no-events' };
        }
        return this.#tryCompact(agent, signal, 'pressure');
    }
    async compactNow(agent, signal, _sourceCommandId) {
        if (!this.#deps.config.llmSummaryEnabled) {
            return { status: 'skipped', reason: 'llmSummaryEnabled=false' };
        }
        return agent.runMaintenance(async () => this.#tryCompact(agent, signal, 'manual'));
    }
    async compactRegion(_start, _end, agent, signal) {
        if (!this.#deps.config.llmSummaryEnabled) {
            return { status: 'skipped', reason: 'llmSummaryEnabled=false' };
        }
        return this.#tryCompact(agent, signal ?? new AbortController().signal, 'pressure');
    }
    async #tryCompact(agent, signal, trigger) {
        try {
            const events = this.#deps.sessionEventsProvider?.(agent.session) ?? [];
            if (events.length === 0) {
                return { status: 'skipped', reason: 'empty-session' };
            }
            const maxTokens = this.#deps.config.llmSummaryMaxInputTokens;
            const input = {
                sessionId: agent.session.id,
                messages: events,
                maxInputTokens: maxTokens,
                customPrompt: this.#deps.config.llmSummaryPrompt,
                signal,
            };
            const out = await this.#deps.callLlm(input);
            const originalTokens = estimateTokens(events);
            if (this.#deps.telemetry?.onCompact) {
                this.#deps.telemetry.onCompact({
                    trigger,
                    originalTokens,
                    summaryTokens: estimateTokens(out.summary),
                    savedTokens: Math.max(0, originalTokens - estimateTokens(out.summary)),
                    engine: 'llm-summary',
                });
            }
            return { status: 'succeeded', summary: out };
        }
        catch (err) {
            const reason = err.message;
            this.#deps.logger?.warn(`token-saver: LLM-summary failed (${reason}); falling back to official-basic`);
            return { status: 'failed', reason };
        }
    }
}
export function estimateTokens(events) {
    let n = 0;
    for (const evt of events) {
        if (!evt || typeof evt !== 'object')
            continue;
        const content = evt.content;
        if (typeof content === 'string') {
            n += Math.ceil(content.length / 4);
        }
        else if (Array.isArray(content)) {
            for (const block of content) {
                if (typeof block === 'string') {
                    n += Math.ceil(block.length / 4);
                }
                else if (block && typeof block === 'object') {
                    const text = block.text;
                    if (typeof text === 'string')
                        n += Math.ceil(text.length / 4);
                }
            }
        }
    }
    return n;
}
export const DEFAULT_COMPACTION_PROMPT = [
    'You are a session compactor. Produce a concise summary that preserves:',
    '1. Active task goal and current step',
    '2. Decisions taken and their rationale',
    '3. Names and exact paths of all files mentioned',
    '4. Pending open questions',
    'Drop duplicated stdout/stderr, repeated tool calls, and confirmable model output.',
    'Return one fenced block per topic. No commentary outside the blocks.',
].join('\n');
