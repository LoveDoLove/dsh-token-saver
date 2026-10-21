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
export const DSH_INJECT_MARKER = '<!-- dsh-token-saver:prompt-shaping -->';
export const DSH_MARKER_END = '<!-- /dsh-token-saver:prompt-shaping -->';
export const OFM_INJECT_MARKER = '<!-- ofm-token-saver -->';
export const OFM_MARKER_END = '<!-- /ofm-token-saver -->';
const SEP = '\n\n';
export function hasAnyPromptShaping(text) {
    if (typeof text !== 'string')
        return false;
    return ((text.includes(DSH_INJECT_MARKER) && text.includes(DSH_MARKER_END)) ||
        (text.includes(OFM_INJECT_MARKER) && text.includes(OFM_MARKER_END)));
}
export function wrapPromptSegment(text) {
    return `${DSH_INJECT_MARKER}\n${text.trim()}\n${DSH_MARKER_END}`;
}
export function injectIntoSystemPrompt(currentSystem, textToInject) {
    const trimmedToInject = textToInject.trim();
    if (!trimmedToInject) {
        return { text: currentSystem ?? '', injected: false, reason: 'empty-text' };
    }
    const base = currentSystem ?? '';
    if (hasAnyPromptShaping(base) || base.includes(trimmedToInject)) {
        return { text: base, injected: false, reason: 'already-injected' };
    }
    const segment = wrapPromptSegment(trimmedToInject);
    if (base === '') {
        return { text: segment, injected: true, reason: 'created' };
    }
    return { text: `${base.trimEnd()}\n\n${segment}`, injected: true, reason: 'appended' };
}
/**
 * Remove every injected prompt region from a plain string.
 *
 * Upstream (`dsh-our-free-model`) removes the marked region together with ONE
 * adjacent separator, so removing a segment from the middle of a prompt does
 * not leave a double blank line behind.
 */
export function stripPromptShaping(text) {
    let out = text;
    for (const [start, end] of [
        [DSH_INJECT_MARKER, DSH_MARKER_END],
        [OFM_INJECT_MARKER, OFM_MARKER_END],
    ]) {
        out = cutMarked(out, start, end) ?? out;
    }
    return out.trim();
}
// ── Multi-wire injection helpers ──────────────────────────────────────────────
function isSystemMessage(message) {
    return (message !== null &&
        typeof message === 'object' &&
        (message.role === 'system' ||
            message.role === 'developer'));
}
function isResponsesSystem(item) {
    return isSystemMessage(item) && item.type === 'message';
}
function hasRegion(text) {
    if (typeof text !== 'string')
        return false;
    return hasAnyPromptShaping(text);
}
/**
 * Remove every marked region (and one adjacent separator) from `text`.
 * Returns `null` when nothing was marked, so callers can tell "unchanged"
 * apart from "changed to the empty string".
 */
function cutMarked(text, startMarker, endMarker) {
    let next = text;
    let cut = false;
    for (;;) {
        const start = next.indexOf(startMarker);
        if (start === -1)
            break;
        const end = next.indexOf(endMarker, start + startMarker.length);
        if (end === -1)
            break;
        let from = start;
        let to = end + endMarker.length;
        if (next.startsWith(SEP, to))
            to += SEP.length;
        else if (next.endsWith(SEP, from))
            from -= SEP.length;
        next = next.slice(0, from) + next.slice(to);
        cut = true;
    }
    return cut ? next : null;
}
function contentHasRegion(content) {
    if (typeof content === 'string')
        return hasRegion(content);
    if (Array.isArray(content)) {
        return content.some((block) => {
            if (block !== null && typeof block === 'object') {
                const text = block.text;
                return typeof text === 'string' && hasRegion(text);
            }
            return false;
        });
    }
    return false;
}
function contentHasSegment(content, segment) {
    if (typeof content === 'string')
        return content.includes(segment);
    if (Array.isArray(content)) {
        return content.some((block) => {
            if (block !== null && typeof block === 'object') {
                const text = block.text;
                return typeof text === 'string' && text.includes(segment);
            }
            return false;
        });
    }
    return false;
}
/**
 * Check if the payload already contains injected prompt shaping across supported wires.
 */
export function hasInjected(payload, wire) {
    try {
        if (payload === null || typeof payload !== 'object')
            return false;
        const obj = payload;
        if (wire === 'chat') {
            if (!Array.isArray(obj.messages))
                return false;
            return obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content));
        }
        if (wire === 'messages') {
            if (contentHasRegion(obj.system))
                return true;
            if (Array.isArray(obj.messages)) {
                return obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content));
            }
            return false;
        }
        if (wire === 'responses') {
            if (hasRegion(obj.instructions))
                return true;
            if (Array.isArray(obj.input)) {
                return obj.input.some((item) => isResponsesSystem(item) && contentHasRegion(item.content));
            }
            return false;
        }
        // Native DSH options: `system` string, or a system-role message.
        if (contentHasRegion(obj.system))
            return true;
        if (Array.isArray(obj.messages)) {
            return obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content));
        }
        return false;
    }
    catch {
        return false;
    }
}
/**
 * The chat-wire system message to extend: upstream prefers `messages[0]` when
 * it is a system/developer turn, and only then falls back to the first system
 * turn anywhere in the list.
 */
function chatSystemMessage(messages) {
    const first = messages[0];
    if (isSystemMessage(first))
        return first;
    return messages.find((m) => isSystemMessage(m));
}
function appendChatSegment(message, segment) {
    if (typeof message.content === 'string') {
        message.content = message.content === '' ? segment : `${message.content}${SEP}${segment}`;
        return;
    }
    if (Array.isArray(message.content)) {
        ;
        message.content.push({ type: 'text', text: segment });
        return;
    }
    message.content = segment;
}
function appendResponsesSegment(item, segment) {
    if (typeof item.content === 'string') {
        item.content = item.content === '' ? segment : `${item.content}${SEP}${segment}`;
        return;
    }
    if (Array.isArray(item.content)) {
        ;
        item.content.push({ type: 'input_text', text: segment });
        return;
    }
    item.content = [{ type: 'input_text', text: segment }];
}
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
export function injectSystem(payload, wire, text) {
    if (payload === null || typeof payload !== 'object') {
        return { payload, injected: false, reason: 'shape-not-recognised' };
    }
    const trimmed = text.trim();
    if (!trimmed) {
        return { payload, injected: false, reason: 'empty-text' };
    }
    const segment = wrapPromptSegment(trimmed);
    const obj = payload;
    const effectiveWire = wire ?? (obj.system !== undefined ? 'messages' : obj.instructions !== undefined ? 'responses' : 'chat');
    // 1. Anthropic Messages style
    if (effectiveWire === 'messages') {
        if (contentHasRegion(obj.system) || contentHasSegment(obj.system, segment)) {
            return { payload, injected: false, reason: 'already-injected' };
        }
        if (typeof obj.system === 'string') {
            obj.system = obj.system === '' ? segment : `${obj.system}${SEP}${segment}`;
            return { payload, injected: true, reason: 'appended' };
        }
        if (Array.isArray(obj.system)) {
            const blocks = obj.system;
            // Insert BEFORE the last cache_control block: the provider cache
            // breakpoint must stay last for the system prompt to stay cache-eligible.
            let lastCached = -1;
            for (let i = blocks.length - 1; i >= 0; i -= 1) {
                if (blocks[i]?.cache_control) {
                    lastCached = i;
                    break;
                }
            }
            const block = { type: 'text', text: segment };
            if (lastCached >= 0)
                blocks.splice(lastCached, 0, block);
            else
                blocks.push(block);
            return { payload, injected: true, reason: 'appended' };
        }
        if (obj.system === undefined || obj.system === null) {
            obj.system = segment;
            return { payload, injected: true, reason: 'created' };
        }
    }
    // 2. OpenAI Chat style
    if (effectiveWire === 'chat') {
        if (!Array.isArray(obj.messages)) {
            return { payload, injected: false, reason: 'shape-not-recognised' };
        }
        const messages = obj.messages;
        // A marked region means prompt shaping already reached this request:
        // injecting again would duplicate it.
        if (messages.some((m) => isSystemMessage(m) &&
            (contentHasRegion(m.content) || contentHasSegment(m.content, segment)))) {
            return { payload, injected: false, reason: 'already-injected' };
        }
        const existing = chatSystemMessage(messages);
        if (existing) {
            appendChatSegment(existing, segment);
            return { payload, injected: true, reason: 'appended' };
        }
        messages.unshift({ role: 'system', content: segment });
        return { payload, injected: true, reason: 'created' };
    }
    // 3. OpenAI Responses style
    if (effectiveWire === 'responses') {
        if (typeof obj.instructions === 'string') {
            if (hasRegion(obj.instructions) || obj.instructions.includes(segment)) {
                return { payload, injected: false, reason: 'already-injected' };
            }
            obj.instructions = obj.instructions === '' ? segment : `${obj.instructions}${SEP}${segment}`;
            return { payload, injected: true, reason: 'appended' };
        }
        if (Array.isArray(obj.input)) {
            const input = obj.input;
            if (input.some((item) => isResponsesSystem(item) && contentHasSegment(item.content, segment))) {
                return { payload, injected: false, reason: 'already-injected' };
            }
            const target = input.find((item) => isResponsesSystem(item));
            if (target === undefined) {
                input.unshift({
                    type: 'message',
                    role: 'system',
                    content: [{ type: 'input_text', text: segment }],
                });
            }
            else {
                appendResponsesSegment(target, segment);
            }
            return { payload, injected: true, reason: 'created' };
        }
    }
    // Fallback for generic DSH object
    if (typeof obj.system === 'string') {
        const res = injectIntoSystemPrompt(obj.system, trimmed);
        obj.system = res.text;
        return { payload, injected: res.injected, reason: res.reason };
    }
    return { payload, injected: false, reason: 'shape-not-recognised' };
}
/**
 * Remove injected prompt segments from payload.
 *
 * Covers every shape `injectSystem` can write: Anthropic `system` (string or
 * block array), chat `messages` (string or block content), and the Responses
 * `instructions` string plus system messages inside `input`. Blocks and
 * messages that become empty are removed, as upstream does.
 */
export function stripInjected(payload, _wire) {
    if (payload === null || typeof payload !== 'object') {
        return { payload, stripped: false, reason: 'shape-not-recognised' };
    }
    const obj = payload;
    let stripped = false;
    // 1. Anthropic `system` (string or block array)
    if (typeof obj.system === 'string') {
        const cleaned = stripPromptShaping(obj.system);
        if (cleaned !== obj.system) {
            obj.system = cleaned;
            stripped = true;
        }
    }
    else if (Array.isArray(obj.system)) {
        const blocks = obj.system;
        for (let i = blocks.length - 1; i >= 0; i -= 1) {
            const block = blocks[i];
            if (block === null || typeof block !== 'object' || typeof block.text !== 'string')
                continue;
            const cleaned = stripPromptShaping(block.text);
            if (cleaned === block.text)
                continue;
            stripped = true;
            if (cleaned === '')
                blocks.splice(i, 1);
            else
                block.text = cleaned;
        }
    }
    // 2. Chat `messages`
    if (Array.isArray(obj.messages)) {
        const messages = obj.messages;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const message = messages[i];
            if (!isSystemMessage(message))
                continue;
            if (typeof message.content === 'string') {
                const cleaned = stripPromptShaping(message.content);
                if (cleaned === message.content)
                    continue;
                stripped = true;
                if (cleaned === '')
                    messages.splice(i, 1);
                else
                    message.content = cleaned;
            }
            else if (Array.isArray(message.content)) {
                const blocks = message.content;
                for (let j = blocks.length - 1; j >= 0; j -= 1) {
                    const block = blocks[j];
                    if (block === null || typeof block !== 'object' || typeof block.text !== 'string')
                        continue;
                    const cleaned = stripPromptShaping(block.text);
                    if (cleaned === block.text)
                        continue;
                    stripped = true;
                    if (cleaned === '')
                        blocks.splice(j, 1);
                    else
                        block.text = cleaned;
                }
            }
        }
    }
    // 3. Responses `instructions`
    if (typeof obj.instructions === 'string') {
        const cleaned = stripPromptShaping(obj.instructions);
        if (cleaned !== obj.instructions) {
            stripped = true;
            if (cleaned === '')
                delete obj.instructions;
            else
                obj.instructions = cleaned;
        }
    }
    // 4. Responses `input` system messages
    if (Array.isArray(obj.input)) {
        const input = obj.input;
        for (let i = input.length - 1; i >= 0; i -= 1) {
            const item = input[i];
            if (!isResponsesSystem(item))
                continue;
            if (typeof item.content === 'string') {
                const cleaned = stripPromptShaping(item.content);
                if (cleaned === item.content)
                    continue;
                stripped = true;
                if (cleaned === '')
                    input.splice(i, 1);
                else
                    item.content = cleaned;
            }
            else if (Array.isArray(item.content)) {
                const parts = item.content;
                for (let j = parts.length - 1; j >= 0; j -= 1) {
                    const part = parts[j];
                    if (part === null || typeof part !== 'object' || typeof part.text !== 'string')
                        continue;
                    const cleaned = stripPromptShaping(part.text);
                    if (cleaned === part.text)
                        continue;
                    stripped = true;
                    if (cleaned === '')
                        parts.splice(j, 1);
                    else
                        part.text = cleaned;
                }
                if (parts.length === 0) {
                    stripped = true;
                    input.splice(i, 1);
                }
            }
        }
    }
    return { payload, stripped, reason: stripped ? 'stripped' : 'none-found' };
}
