/**
 * Synthetic stream chunk generator for local responses.
 * Emits canonical DSH StreamChunk protocol items: block-start, text-delta, block-end, usage, finish.
 */

import type { LocalAnswer } from './detectors'

export interface LocalStreamChunk {
  readonly type: 'block-start' | 'text-delta' | 'block-end' | 'usage' | 'finish'
  readonly index?: number
  readonly blockType?: string
  readonly text?: string
  readonly delta?: string
  readonly block?: { readonly type: string; readonly text: string }
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly input?: number
    readonly output?: number
  }
  readonly reason?: string | { readonly kind: string }
}

export async function* createLocalResponseStream(
  answer: LocalAnswer,
): AsyncIterable<LocalStreamChunk> {
  const text = answer.text

  // Canonical DSH streaming sequence:
  yield {
    type: 'block-start',
    index: 0,
    blockType: 'text',
  }

  yield {
    type: 'text-delta',
    index: 0,
    text,
    delta: text,
  }

  yield {
    type: 'block-end',
    index: 0,
    block: {
      type: 'text',
      text,
    },
  }

  const input =
    answer.usage.input ??
    (answer.usage as { input_tokens?: number }).input_tokens ??
    0
  const output =
    answer.usage.output ??
    (answer.usage as { output_tokens?: number }).output_tokens ??
    0

  yield {
    type: 'usage',
    usage: {
      inputTokens: input,
      outputTokens: output,
      input,
      output,
    },
  }

  yield {
    type: 'finish',
    reason: 'stop',
  }
}
