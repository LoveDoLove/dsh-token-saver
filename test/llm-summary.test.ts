import { describe, expect, it } from 'vitest'
import { LlmSummaryCompactionEngine, estimateTokens, DEFAULT_COMPACTION_PROMPT } from '../src/strategies/llm-summary'
import { resolveConfig } from '../src/config'
import type { AgentLike } from '../src/types'

describe('LlmSummaryCompactionEngine', () => {
  it('skips when llmSummaryEnabled is false', async () => {
    const cfg = resolveConfig({ mode: 'conservative', llmSummaryEnabled: false })
    const engine = new LlmSummaryCompactionEngine({
      config: cfg,
      callLlm: async () => ({ summary: [], shadowedTokenCount: 0 }),
    })
    const agent: AgentLike = { session: { id: 's' } }
    const out = await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    expect(out.status).toBe('skipped')
  })

  it('returns succeeded when llm succeeds', async () => {
    const cfg = resolveConfig({ mode: 'aggressive', llmSummaryEnabled: true })
    const events = [{ content: 'hello there friend'.repeat(200) }]
    let received: unknown
    const engine = new LlmSummaryCompactionEngine({
      config: cfg,
      callLlm: async (input) => {
        received = input
        return { summary: [{ type: 'text', text: 'short summary' }], shadowedTokenCount: 6 }
      },
      sessionEventsProvider: () => events,
    })
    const agent: AgentLike = { session: { id: 's' } }
    const out = await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    expect(out.status).toBe('succeeded')
    expect((received as { sessionId: string }).sessionId).toBe('s')
    expect(((out as { summary?: unknown }).summary as { shadowedTokenCount: number }).shadowedTokenCount).toBe(6)
  })

  it('reports failed on llm error and emits telemetry', async () => {
    const cfg = resolveConfig({ mode: 'aggressive', llmSummaryEnabled: true })
    const telemetryEvents: unknown[] = []
    const engine = new LlmSummaryCompactionEngine({
      config: cfg,
      callLlm: async () => {
        throw new Error('network down')
      },
      telemetry: { onCompact: (e) => telemetryEvents.push(e) },
      sessionEventsProvider: () => [{ content: 'some events' }],
    })
    const agent: AgentLike = { session: { id: 's' } }
    const out = await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    expect(out.status).toBe('failed')
    expect(telemetryEvents.length).toBe(0)
  })

  it('estimateTokens counts characters', () => {
    const events = [{ content: 'hello world' }, { content: ['a', 'b', 'cc'] }]
    const tokens = estimateTokens(events)
    expect(tokens).toBe(Math.ceil('hello world'.length / 4) + Math.ceil(1 / 4) + Math.ceil(1 / 4) + Math.ceil(2 / 4))
  })
})

describe('DEFAULT_COMPACTION_PROMPT', () => {
  it('mentions tasks, decisions, files, and pending questions', () => {
    expect(DEFAULT_COMPACTION_PROMPT).toContain('task goal')
    expect(DEFAULT_COMPACTION_PROMPT).toContain('Decisions')
    expect(DEFAULT_COMPACTION_PROMPT).toContain('files')
    expect(DEFAULT_COMPACTION_PROMPT).toContain('Pending open questions')
  })
})
