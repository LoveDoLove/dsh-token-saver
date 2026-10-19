import { describe, expect, it } from 'vitest'
import { decidePostTool } from '../src/strategies/tool-result-trim'
import { resolveConfig } from '../src/config'

const baseCfg = () => resolveConfig({ mode: 'conservative' })

describe('decidePostTool', () => {
  it('passes through when tool name is missing', () => {
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: '' } }, result: { content: [{ type: 'text', text: 'a' }] } },
      { config: baseCfg() },
    )
    expect(out.folded).toBe(false)
  })

  it('passes through when result is small', () => {
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text: 'tiny result' }] } },
      { config: baseCfg() },
    )
    expect(out.folded).toBe(false)
  })

  it('truncates a large read tool result keeping head and tail', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i.toString().padStart(6, '0')}-with-some-content`).join('\n')
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text: big }] } },
      { config: baseCfg() },
    )
    expect(out.folded).toBe(true)
    expect(out.trimmedBytes).toBeLessThan(out.originalBytes)
    expect(out.decision.kind).toBe('accept')
    expect(Array.isArray(out.decision.content)).toBe(true)
  })

  it('respects excludeToolNames', () => {
    const cfg = resolveConfig({ excludeToolNames: ['protected_tool'] })
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'protected_tool' } }, result: { content: [{ type: 'text', text: 'A'.repeat(50000) }] } },
      { config: cfg },
    )
    expect(out.folded).toBe(false)
  })

  it('respects includeToolNames when set', () => {
    const cfg = resolveConfig({ includeToolNames: ['grep'], mode: 'balanced' })
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'grep' } }, result: { content: [{ type: 'text', text: 'A'.repeat(50000) }] } },
      { config: cfg },
    )
    expect(out.folded).toBe(true)
  })

  it('skips isError results to preserve error context', () => {
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text: 'A'.repeat(50000) }], isError: true } },
      { config: baseCfg() },
    )
    expect(out.folded).toBe(false)
  })

  it('preserves value-only results when content is empty', () => {
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { value: { ok: true } } },
      { config: baseCfg() },
    )
    expect(out.folded).toBe(false)
  })

  it('emits telemetry when configured', () => {
    let last: unknown
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text: 'A'.repeat(50000) }] } },
      { config: baseCfg(), telemetry: { onFold: (e) => { last = e } } },
    )
    expect(out.folded).toBe(true)
    expect(last).toBeDefined()
    expect((last as { toolName: string }).toolName).toBe('read')
  })

  it('keeps mode=off as no-op', () => {
    const cfg = resolveConfig({ mode: 'off' })
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text: 'A'.repeat(50000) }] } },
      { config: cfg },
    )
    expect(out.folded).toBe(false)
  })
})
