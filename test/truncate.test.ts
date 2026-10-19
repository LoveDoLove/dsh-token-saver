import { describe, expect, it } from 'vitest'
import { truncate, truncateHead, truncateTail } from '../src/lib/truncate'

describe('truncate', () => {
  it('returns unchanged when content fits within budget', () => {
    const text = 'small'
    const out = truncate(text, { headBytes: 10, tailBytes: 10 })
    expect(out.folded).toBe(false)
    expect(out.strategy).toBe('unchanged')
    expect(out.content).toBe(text)
  })

  it('keeps head and tail when content exceeds budget', () => {
    const text = Array.from({ length: 500 }, (_, i) => `line-${i.toString().padStart(3, '0')}`).join('\n')
    const out = truncate(text, { headBytes: 256, tailBytes: 256, separator: '\n[OMITTED]\n' })
    expect(out.folded).toBe(true)
    expect(out.strategy).toBe('head-tail')
    expect(out.content).toContain('[OMITTED]')
    expect(out.content).toMatch(/^line-000/)
    expect(out.content).toMatch(/line-499$/)
    expect(out.omittedBytes).toBeGreaterThan(0)
    expect(out.headBytesKept).toBeGreaterThan(0)
    expect(out.tailBytesKept).toBeGreaterThan(0)
  })

  it('falls back to byte-slicing when preserveStructure is false', () => {
    const text = 'A'.repeat(2000)
    const out = truncate(text, { headBytes: 100, tailBytes: 100, preserveStructure: false, separator: '...' })
    expect(out.folded).toBe(true)
    expect(out.strategy).toBe('head-tail')
    expect(out.headBytesKept).toBeLessThanOrEqual(100)
    expect(out.tailBytesKept).toBeLessThanOrEqual(100)
  })

  it('truncateHead only preserves head with marker', () => {
    const text = 'a'.repeat(500)
    const out = truncateHead(text, 50)
    expect(out.folded).toBe(true)
    expect(out.strategy).toBe('head-only')
    expect(out.tailBytesKept).toBe(0)
  })

  it('truncateTail only preserves tail with marker', () => {
    const text = 'a'.repeat(500)
    const out = truncateTail(text, 50)
    expect(out.folded).toBe(true)
    expect(out.strategy).toBe('tail-only')
    expect(out.headBytesKept).toBe(0)
  })

it('handles multi-byte UTF-8 strings without breaking in the middle of a codepoint', () => {
    const text = '\u5b57'.repeat(2000)
    const out = truncate(text, { headBytes: 100, tailBytes: 100, separator: '...' })
    expect(out.folded).toBe(true)
    expect(out.content).toContain('...')
  })

  it('skips truncation when budget is zero', () => {
    const text = 'hello'
    const out = truncate(text, { headBytes: 0, tailBytes: 0 })
    expect(out.folded).toBe(false)
    expect(out.strategy).toBe('unchanged')
    expect(out.content).toBe(text)
  })

  it('truncates when content is just slightly bigger than budget', () => {
    const text = 'x'.repeat(300)
    const out = truncate(text, { headBytes: 100, tailBytes: 100, separator: 'OMIT' })
    expect(out.folded).toBe(true)
    expect(out.content.endsWith('OMIT')).toBe(false)
    expect(out.content).toContain('OMIT')
  })
})
