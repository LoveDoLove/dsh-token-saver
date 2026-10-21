/**
 * Detectors for the five local response optimizations.
 * Ported and adapted from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Supports both DSH GenerateOptions and Anthropic wire request shapes.
 */
import { extractCommandPrefix, extractFilepathsFromCommand, truncateOutput, } from './command.js';
export const OPTIMIZATIONS = [
    'quota',
    'prefix',
    'title',
    'suggestion',
    'filepath',
];
export const LOCAL_RESPONSE_KINDS = OPTIMIZATIONS;
export function makeUsage(input, output) {
    return {
        input,
        output,
        input_tokens: input,
        output_tokens: output,
    };
}
export function textOf(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => {
            if (typeof block === 'string')
                return block;
            if (block && typeof block === 'object') {
                const rec = block;
                if (typeof rec.text === 'string')
                    return rec.text;
                if (rec.type === 'text' && typeof rec.text === 'string')
                    return rec.text;
            }
            return '';
        })
            .filter((t) => t.length > 0)
            .join('\n');
    }
    return '';
}
export function systemText(request) {
    if (!request)
        return '';
    const parts = [];
    if (typeof request.system === 'string') {
        parts.push(request.system);
    }
    else if (Array.isArray(request.system)) {
        parts.push(textOf(request.system));
    }
    for (const message of request.messages ?? []) {
        if (message?.role === 'system') {
            parts.push(textOf(message.content));
        }
    }
    return parts.join('\n');
}
export function singleUserTurn(request) {
    if (!request?.messages || !Array.isArray(request.messages))
        return undefined;
    let foundUser;
    for (const message of request.messages) {
        if (message?.role === 'system')
            continue;
        if (message?.role === 'user') {
            if (foundUser !== undefined)
                return undefined; // more than one user turn
            foundUser = message;
        }
        else {
            // Any assistant or tool response means this is not a lone user turn
            return undefined;
        }
    }
    return foundUser;
}
export function hasTools(request) {
    return Array.isArray(request?.tools) && request.tools.length > 0;
}
export function quotaAnswer(request) {
    const message = singleUserTurn(request);
    if (message === undefined)
        return null;
    const text = textOf(message.content).trim().toLowerCase();
    const maxTokens = request?.maxTokens ?? request?.max_tokens;
    const hasMax1 = maxTokens === 1 || maxTokens === '1';
    // Quota probe: a lone user turn that asks about quota, sent with a
    // one-token budget. Upstream dsh-our-free-model gates the same answer on
    // `max_tokens === 1` plus the word "quota"; DSH spells the budget
    // `maxTokens`, so both spellings are accepted.
    //
    // A bare integer message is NOT a quota probe. It is an ordinary user
    // message, and answering it locally would swallow a real request without
    // ever reaching the model.
    if (hasMax1 && text.includes('quota')) {
        return {
            kind: 'quota',
            text: 'Quota check passed.',
            usage: makeUsage(10, 5),
            model: request?.model,
        };
    }
    return null;
}
export function prefixAnswer(request) {
    const message = singleUserTurn(request);
    if (message === undefined)
        return null;
    const content = textOf(message.content);
    if (!content.includes('<policy_spec>') || !content.includes('Command:'))
        return null;
    const start = content.lastIndexOf('Command:') + 'Command:'.length;
    return {
        kind: 'prefix',
        text: extractCommandPrefix(content.slice(start).trim()),
        usage: makeUsage(100, 5),
        model: request?.model,
    };
}
export function titleAnswer(request) {
    if (hasTools(request))
        return null;
    // Native DSH purpose check
    if (request?.purpose === 'session-title') {
        return {
            kind: 'title',
            text: 'Conversation',
            usage: makeUsage(100, 5),
            model: request?.model,
        };
    }
    const system = systemText(request).toLowerCase();
    if (!system.includes('title'))
        return null;
    const sentenceCase = system.includes('sentence-case title');
    const jsonField = system.includes('return json') &&
        system.includes('field') &&
        (system.includes('coding session') || system.includes('this session'));
    if (!sentenceCase && !jsonField)
        return null;
    return {
        kind: 'title',
        text: 'Conversation',
        usage: makeUsage(100, 5),
        model: request?.model,
    };
}
export function suggestionAnswer(request) {
    for (const message of request?.messages ?? []) {
        if (message?.role !== 'user')
            continue;
        if (textOf(message.content).includes('[SUGGESTION MODE:')) {
            return {
                kind: 'suggestion',
                text: '',
                usage: makeUsage(100, 1),
                model: request?.model,
            };
        }
    }
    return null;
}
export function filepathAnswer(request) {
    const message = singleUserTurn(request);
    if (message === undefined || hasTools(request))
        return null;
    const content = textOf(message.content);
    if (!content.includes('Command:') || !content.includes('Output:'))
        return null;
    const lower = content.toLowerCase();
    // Upstream only accepts the two explicit phrasings. The looser
    // "file paths" / "filepath" substrings matched ordinary requests (any
    // message mentioning a file path) and answered them locally.
    const userNamesFilepaths = lower.includes('filepaths');
    const system = systemText(request).toLowerCase();
    const systemAsksForPaths = system.includes('extract any file paths') || system.includes('file paths that this command');
    if (!userNamesFilepaths && !systemAsksForPaths)
        return null;
    const start = content.indexOf('Command:') + 'Command:'.length;
    const marker = content.indexOf('Output:', start);
    if (marker === -1)
        return null;
    const command = content.slice(start, marker).trim();
    const output = truncateOutput(content.slice(marker + 'Output:'.length).trim());
    return {
        kind: 'filepath',
        text: extractFilepathsFromCommand(command, output),
        usage: makeUsage(100, 10),
        model: request?.model,
    };
}
export const DETECTORS = {
    quota: quotaAnswer,
    prefix: prefixAnswer,
    title: titleAnswer,
    suggestion: suggestionAnswer,
    filepath: filepathAnswer,
};
export function detectOptimization(request, enabledKinds = new Set(OPTIMIZATIONS)) {
    for (const kind of OPTIMIZATIONS) {
        if (!enabledKinds.has(kind))
            continue;
        const detector = DETECTORS[kind];
        const answer = detector(request);
        if (answer !== null)
            return answer;
    }
    return null;
}
/**
 * Try detecting any enabled local response optimization.
 */
export function tryLocalResponses(request, enabled) {
    const kinds = new Set();
    for (const k of OPTIMIZATIONS) {
        if (enabled === undefined || enabled[k] !== false) {
            kinds.add(k);
        }
    }
    return detectOptimization(request, kinds);
}
/**
 * Convenient alias for tryLocalResponses.
 */
export const detectLocalResponse = tryLocalResponses;
