import { describe, expect, it } from 'vitest'
import { decidePostTool, __testing } from '../src/strategies/tool-result-trim'
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

  it('runs RTK on sub-threshold compressible tool output', () => {
    const cfg = resolveConfig({ mode: 'conservative', rtkEnabled: true })
    const logLines = ['commit 0123456789abcdef0123456789abcdef01234567']
    for (let i = 0; i < 80; i++) {
      logLines.push('commit 000000000000000000000000000000000000000' + String(i % 10))
      logLines.push('Author: Developer <dev@example.com>')
      logLines.push('Date:   Sun Oct 18 20:00:00 2026 +0800')
      logLines.push('    fix: sample commit ' + i)
    }
    const smallGitLog = logLines.join('\n')
    // Must be under the head+tail+256 threshold (conservative defaults).
    expect(smallGitLog.length).toBeLessThan(16 * 1024 + 8 * 1024 + 200)

    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'bash' } }, result: { content: [{ type: 'text', text: smallGitLog }] } },
      { config: cfg },
    )
    expect(out.folded).toBe(true)
    expect(out.trimmedBytes).toBeLessThan(out.originalBytes)
    const text = out.decision.content?.[0]?.text ?? ''
    expect(text).toContain('0123456')
  })

  it('keeps sub-threshold incompressible output verbatim', () => {
    const cfg = resolveConfig({ mode: 'conservative', rtkEnabled: true })
    const text = 'lorem ipsum '.repeat(300)
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'read' } }, result: { content: [{ type: 'text', text }] } },
      { config: cfg },
    )
    expect(out.folded).toBe(false)
    expect(out.decision.content?.[0]?.text).toBe(text)
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

  it('does not drop lines from a grep result when no search pattern is supplied', () => {
    // Small enough that head/tail truncation does not fire, so the output must be
    // byte-identical to the input: no pattern-based folding occurs.
    const lines = Array.from({ length: 20 }, (_, i) => `/src/foo.ts:${i + 1}: match ${i} with context`)
    const text = lines.join('\n')
    const cfg = resolveConfig({ includeToolNames: ['grep'], mode: 'balanced' })
    const out = decidePostTool(
      { exec: { id: 'x', tool: { name: 'grep' } }, result: { content: [{ type: 'text', text }] } },
      { config: cfg },
    )
    expect(out.originalBytes).toBe(Buffer.byteLength(text, 'utf8'))
    expect(out.trimmedBytes).toBe(out.originalBytes)
    expect(out.folded).toBe(false)
    const decisionContent = (out.decision as { content?: readonly { text?: string }[] }).content
    expect(Array.isArray(decisionContent)).toBe(true)
    expect((decisionContent as { text?: string }[])[0]?.text).toBe(text)
  })

  it('folds non-matching lines when the grep pattern is supplied in exec.arguments', () => {
    const text = grepDump(400)
    const cfg = grepCfg()
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(32 * 1024)

    const out = decidePostTool(
      { exec: { name: 'grep', arguments: { pattern: 'needle' } }, result: { content: [{ type: 'text', text }] } },
      { config: cfg },
    )
    const folded = out.decision.content?.[0]?.text ?? ''
    expect(out.folded).toBe(true)
    expect(out.trimmedBytes).toBeLessThan(out.originalBytes)
    expect(folded).toContain('needle')
    expect(folded).toMatch(/non-matching lines omitted/)
    // A line that never matched and sits outside the context window is gone.
    expect(folded).not.toContain('filler 0 ')
  })

  it('preserves the grep result when the pattern matches nothing', () => {
    const text = grepDump(400)
    const cfg = grepCfg()
    const out = decidePostTool(
      { exec: { name: 'grep', arguments: { pattern: 'absent-needle' } }, result: { content: [{ type: 'text', text }] } },
      { config: cfg },
    )
    // No matches means no pattern folding, only the byte-range fallback.
    expect(out.decision.content?.[0]?.text ?? '').not.toContain('non-matching lines omitted')
  })

  it('preserves the grep result when the pattern is not a non-empty string', () => {
    const text = grepDump(400)
    const cfg = grepCfg()
    for (const args of [{}, { pattern: '' }, { pattern: 42 }, { pattern: null }, null, [], 'needle']) {
      const out = decidePostTool(
        { exec: { name: 'grep', arguments: args }, result: { content: [{ type: 'text', text }] } },
        { config: cfg },
      )
      const body = out.decision.content?.[0]?.text ?? ''
      expect(body).not.toContain('non-matching lines omitted')
    }
  })

  it('ignores the pattern argument for non-grep tools', () => {
    const text = grepDump(400)
    const out = decidePostTool(
      { exec: { name: 'read', arguments: { pattern: 'needle' } }, result: { content: [{ type: 'text', text }] } },
      { config: grepCfg() },
    )
    expect(out.decision.content?.[0]?.text ?? '').not.toContain('non-matching lines omitted')
  })
})

/** Grep-shaped dump: every 20th line matches `needle`, the rest are filler. */
function grepDump(files: number): string {
  const lines: string[] = []
  for (let f = 0; f < files; f++) {
    lines.push(`/src/mod${f}.ts:`)
    for (let i = 0; i < 20; i++) {
      lines.push(
        i === 10
          ? `/src/mod${f}.ts:${i + 1}: const needle${f} = find(needle)`
          : `/src/mod${f}.ts:${i + 1}: filler ${i} value ${'x'.repeat(40)}`,
      )
    }
  }
  return lines.join('\n')
}

/** Grep folding sits behind the same head+tail+256 gate as plain truncation. */
function grepCfg() {
  return resolveConfig({ includeToolNames: ['grep'], mode: 'balanced', rtkEnabled: false })
}

/**
 * Faithful reimplementation of the lossless-JSON rules enforced by DSH
 * (dsh-util-values walkJsonValue) so tests can assert that a folded tool
 * result survives the harness's strict snapshot before it is shipped.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isPlainArray(v: unknown[]): boolean {
  if (Object.getPrototypeOf(v) !== Array.prototype) return false
  // DSH requires arrays to carry exactly `length + 1` own keys (the index
  // slots plus the non-enumerable `length`); holes or extra props fail.
  return Reflect.ownKeys(v).length === v.length + 1
}

function isLossless(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null) return true
  switch (typeof value) {
    case 'boolean':
      return true
    case 'string':
      return true
    case 'number':
      return Number.isFinite(value) && !Object.is(value, -0)
    case 'object': {
      if (seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) {
        if (!isPlainArray(value)) return false
        for (const item of value) if (!isLossless(item, seen)) return false
        return true
      }
      if (!isPlainObject(value)) return false
      for (const key of Object.keys(value)) {
        if (!isLossless((value as Record<string, unknown>)[key], seen)) return false
      }
      return true
    }
    default:
      return false
  }
}

const losslessCfg = () => resolveConfig({ mode: 'conservative', rtkEnabled: true })

const bigText = (n: number) => Array.from({ length: n }, (_, i) => `line-${i.toString().padStart(6, '0')}-match-here`).join('\n')

describe('decidePostTool strict JSON serialization', () => {
  it('keeps single-block folded output losslessly serializable (bash)', () => {
    const out = decidePostTool(
      { exec: { name: 'bash' }, result: { content: [{ type: 'text', text: bigText(5000) }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(true)
    expect(out.decision.content?.[0]).not.toHaveProperty('data')
    expect(isLossless(out.decision)).toBe(true)
  })

  it('keeps single-block folded output losslessly serializable (code)', () => {
    const out = decidePostTool(
      { exec: { name: 'code' }, result: { content: [{ type: 'text', text: bigText(5000) }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(true)
    expect(out.decision.content?.[0]).not.toHaveProperty('data')
    expect(isLossless(out.decision)).toBe(true)
  })

  it('keeps grep-folded output losslessly serializable', () => {
    const out = decidePostTool(
      { exec: { name: 'grep' }, result: { content: [{ type: 'text', text: bigText(5000) }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(true)
    expect(isLossless(out.decision)).toBe(true)
  })

  it('keeps multi-block folded output losslessly serializable', () => {
    const out = decidePostTool(
      { exec: { name: 'read' }, result: { content: [{ type: 'text', text: bigText(2500) }, { type: 'text', text: bigText(2500) }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(true)
    expect(isLossless(out.decision)).toBe(true)
  })

  it('keeps error output losslessly serializable and verbatim', () => {
    const err = `Error: something failed\n${'x'.repeat(50000)}`
    const out = decidePostTool(
      { exec: { name: 'bash' }, result: { isError: true, content: [{ type: 'text', text: err }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(false)
    // Error results are never folded: the decision is a plain accept and the
    // upstream harness preserves the original content verbatim.
    expect(out.decision.kind).toBe('accept')
    expect(out.decision.content).toBeUndefined()
    expect(isLossless(out.decision)).toBe(true)
  })

  it('keeps sub-threshold output losslessly serializable', () => {
    const out = decidePostTool(
      { exec: { name: 'read' }, result: { content: [{ type: 'text', text: 'lorem ipsum '.repeat(300) }] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(false)
    expect(isLossless(out.decision)).toBe(true)
  })

  it('fails open and returns a lossless accept decision on internal errors', () => {
    const out = decidePostTool(
      { exec: { name: 'read' }, result: { content: [{ type: 'text' } as never] } },
      { config: losslessCfg() },
    )
    expect(out.folded).toBe(false)
    expect(out.decision.kind).toBe('accept')
    expect(isLossless(out.decision)).toBe(true)
  })
})

describe('rebuildContent lossless contract', () => {
  it('omits undefined-valued keys inherited from the original block', () => {
    const original = bigText(3000)
    const content = [
      { type: 'text', text: original, data: undefined },
      { type: 'text', text: original, data: undefined },
    ]
    const out = __testing.rebuildContent(content, [], 'short', original)
    expect(out.length).toBe(2)
    for (const block of out) {
      expect(Object.prototype.hasOwnProperty.call(block, 'data')).toBe(false)
    }
    expect(isLossless(out)).toBe(true)
  })

  it('keeps the single-block fast path free of the data key', () => {
    const original = bigText(3000)
    const out = __testing.rebuildContent([{ type: 'text', text: original, data: undefined }], [], 'short', original)
    expect(out.length).toBe(1)
    expect(out[0]).not.toHaveProperty('data')
    expect(isLossless(out)).toBe(true)
  })

  it('preserves non-text blocks while stripping undefined keys', () => {
    const original = bigText(3000)
    const out = __testing.rebuildContent(
      [{ type: 'text', text: original }, { type: 'image', data: undefined } as never],
      [],
      'short',
      original,
    )
    expect(out.length).toBe(2)
    expect(isLossless(out)).toBe(true)
  })
})
