/**
 * Synthetic stream chunk generator for local responses.
 * Emits canonical DSH StreamChunk protocol items: block-start, text-delta, block-end, usage, finish.
 */
export async function* createLocalResponseStream(answer) {
    const text = answer.text;
    // Canonical DSH streaming sequence:
    yield {
        type: 'block-start',
        index: 0,
        blockType: 'text',
    };
    yield {
        type: 'text-delta',
        index: 0,
        text,
        delta: text,
    };
    yield {
        type: 'block-end',
        index: 0,
        block: {
            type: 'text',
            text,
        },
    };
    const input = answer.usage.input ??
        answer.usage.input_tokens ??
        0;
    const output = answer.usage.output ??
        answer.usage.output_tokens ??
        0;
    yield {
        type: 'usage',
        usage: {
            inputTokens: input,
            outputTokens: output,
            input,
            output,
        },
    };
    yield {
        type: 'finish',
        reason: 'stop',
    };
}
