/**
 * Synthetic stream chunk generator for local responses.
 * Emits canonical DSH StreamChunk protocol items: block-start, text-delta, block-end, usage, finish.
 *
 * Contract notes (DSH 0.2.1-rc.2, `dsh-llm/lib/types/types.d.ts`):
 * - `finish.reason` is a `FinishReason` OBJECT (`{ kind: 'stop' }`), never a string;
 *   the agent loop reads `finish.kind`.
 * - `usage` is a `TokenUsage` with numeric `inputTokens` / `outputTokens` and an
 *   optional `totalTokens`.
 *
 * A local response never calls an upstream model, so the reported usage is the
 * REAL consumption of that turn: zero. The nominal upstream cost that the local
 * answer avoided is NOT reported here — it would be counted as real model
 * consumption by `dsh-token-meter`, which reads the `usage` chunk of the stream.
 * It is surfaced through the telemetry event instead
 * (`LocalResponseEvent.promptTokensEstimate` / `savedTokensEstimate`).
 */

import type { LocalAnswer } from './detectors.js'

export interface LocalStreamChunk {
  readonly type: 'block-start' | 'text-delta' | 'block-end' | 'usage' | 'finish'
  readonly index?: number
  readonly blockType?: string
  readonly text?: string
  readonly block?: { readonly type: string; readonly text: string }
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly input?: number
    readonly output?: number
  }
  readonly reason?: string | { readonly kind: string }
}

/**
 * The nominal (simulated) token cost of the upstream call a local answer
 * replaced. These are the constants upstream `dsh-our-free-model` attaches to
 * each local answer; they are estimates, never real consumption.
 */
export function localAnswerEstimate(answer: LocalAnswer): {
  promptTokensEstimate: number
  savedTokensEstimate: number
} {
  const input = answer.usage.input ?? (answer.usage as { input_tokens?: number }).input_tokens ?? 0
  const output = answer.usage.output ?? (answer.usage as { output_tokens?: number }).output_tokens ?? 0
  return {
    promptTokensEstimate: input,
    savedTokensEstimate: input + output,
  }
}

export async function* createLocalResponseStream(answer: LocalAnswer): AsyncIterable<LocalStreamChunk> {
  const text = answer.text

  yield {
    type: 'block-start',
    index: 0,
    blockType: 'text',
  }

  yield {
    type: 'text-delta',
    index: 0,
    text,
  }

  yield {
    type: 'block-end',
    index: 0,
    block: {
      type: 'text',
      text,
    },
  }

  // No upstream model was called for this turn: report zero real consumption.
  yield {
    type: 'usage',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  }

  yield {
    type: 'finish',
    reason: { kind: 'stop' },
  }
}
