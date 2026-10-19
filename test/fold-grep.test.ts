import { describe, expect, it } from 'vitest'
import { foldGrepResult } from '../src/lib/fold-grep'

describe('foldGrepResult', () => {
  const sample = Array.from({ length: 50 }, (_, i) =>
    i % 7 === 0 ? `src/file_${i}.ts:MATCH_KEY_${i}` : `src/file_${i}.ts:const x = ${i}`,
  ).join('\n')

  it('keeps only matching lines when no pattern is given', () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `data-${i}`).join('\n')
    const out = foldGrepResult(huge, { grepMaxMatches: 5, grepContextLines: 0 })
    expect(out.folded).toBe(true)
  })

  it('preserves matches around matched line', () => {
    const out = foldGrepResult(sample, { pattern: 'MATCH_KEY_14', grepContextLines: 1, grepMaxMatches: 100 })
    expect(out.content).toContain('MATCH_KEY_14')
  })

  it('truncates extra matches beyond maxMatches', () => {
    const text = Array.from({ length: 200 }, (_, i) => `src/file_${i}.ts:MATCH`).join('\n')
    const out = foldGrepResult(text, { pattern: 'MATCH', grepMaxMatches: 10, grepContextLines: 0 })
    expect(out.truncatedMatches).toBeGreaterThan(0)
    expect(out.content).toContain('additional matches truncated')
  })

  it('falls back to head-tail truncation when no pattern match', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `data-line-${i}`).join('\n')
    const out = foldGrepResult(text, { pattern: 'no-match', grepHeadBytes: 200, grepTailBytes: 100, grepMaxMatches: 5 })
    expect(out.matchCount).toBe(0)
    expect(out.content).toContain('omitted')
  })

  it('works with regex pattern /.../', () => {
    const out = foldGrepResult(sample, { pattern: '/MATCH_KEY_(\\d+)/', grepContextLines: 0, grepMaxMatches: 5 })
    expect(out.matchCount).toBeGreaterThanOrEqual(1)
  })
})
