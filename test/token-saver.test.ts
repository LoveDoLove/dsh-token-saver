import { describe, it, expect } from 'vitest'
import {
  compressMessages,
  compressRequest,
  describeSavings,
  applyTokenSavers,
  formatBytes,
  emptySavings,
  addSavings,
  savingsPercent,
  describeSavingsTotal,
  type RtkStats,
  type TokenSaverReport,
} from '../src/index.js'

const rawDiff = [
  'diff --git a/foo.ts b/foo.ts',
  'index 1234567..89abcdef 100644',
  '--- a/foo.ts',
  '+++ b/foo.ts',
  '@@ -1,5 +1,200 @@',
  ...Array.from({ length: 150 }, (_, i) => `+ const x${i} = ${i};`),
].join('\n')

describe('Global Token Compression (adapted from dsh-our-free-model)', () => {
  it('formats byte quantities accurately', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })

  it('compresses tool result messages in chat arrays', () => {
    const messages = [
      { role: 'user', content: 'run git diff' },
      { role: 'assistant', content: 'running diff' },
      { role: 'tool', content: rawDiff },
    ]

    const stats = compressMessages(messages, 'chat', true)
    expect(stats).not.toBeNull()
    expect(stats!.saved).toBeGreaterThan(0)
    expect(stats!.hits.length).toBe(1)
    expect(stats!.hits[0]?.filter).toBe('git-diff')

    // Tool message should be compressed with git-diff format
    const toolMsg = messages[2]
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('foo.ts')
    expect(toolMsg?.content).toContain('lines truncated')
  })

  it('compresses tool responses in responses array wire format', () => {
    const payload = {
      model: 'deepseek-chat',
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'check diff' },
            { type: 'text', text: rawDiff },
          ],
        },
      ],
    }

    const { stats } = compressRequest(payload, 'responses', true)
    expect(stats).not.toBeNull()
    expect(stats.saved).toBeGreaterThan(0)
    const block = payload.input[0]?.content[1]
    expect(block).toBeDefined()
    expect(block?.text).toContain('lines truncated')
  })

  it('formats human readable summary descriptions', () => {
    const stats: RtkStats = {
      bytesBefore: 10000,
      bytesAfter: 2000,
      saved: 8000,
      hits: [{ filter: 'git-diff', originalBytes: 10000, compactedBytes: 2000, savedBytes: 8000 }],
    }
    const summary = describeSavings(stats)
    expect(summary).toContain('80%')
    expect(summary).toContain('git-diff')
  })

  it('aggregates cumulative savings accurately', () => {
    let totals = emptySavings()
    expect(totals.calls).toBe(0)
    expect(describeSavingsTotal(totals)).toBe('token saver: no requests measured yet')

    const report1: TokenSaverReport = {
      prompt: { injected: true, reason: 'ok', families: ['caveman:lite'] },
      rtk: {
        bytesBefore: 1000,
        bytesAfter: 500,
        saved: 500,
        hits: [{ filter: 'git-diff', originalBytes: 1000, compactedBytes: 500, savedBytes: 500 }],
      },
      saved: 500,
      bytesBefore: 1000,
      bytesAfter: 500,
      notes: [],
    }

    totals = addSavings(totals, report1)
    expect(totals.calls).toBe(1)
    expect(totals.saved).toBe(500)
    expect(totals.promptCalls).toBe(1)
    expect(savingsPercent(totals)).toBe(50)
    expect(describeSavingsTotal(totals)).toContain('500 B saved over 1 request(s) (50%)')
  })

  it('applies the full pipeline (prompt shaping + RTK) to outbound requests', () => {
    const req = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'What is the git diff?' },
        { role: 'tool', content: rawDiff },
      ],
    }

    const report = applyTokenSavers(req, 'chat', {
      enabled: true,
      cavemanLevel: 'lite',
      rtkEnabled: true,
    })

    expect(report.prompt).not.toBeNull()
    expect(report.prompt!.injected).toBe(true)
    expect(report.rtk).not.toBeNull()
    expect(report.saved).toBeGreaterThan(0)
    expect(req.messages[0]?.content).toContain('dsh-token-saver:prompt-shaping')
    expect(req.messages[0]?.content).toContain('Respond tersely')
    expect(req.messages[2]?.content).toContain('foo.ts')
  })

  it('respects enabled: false in pipeline', () => {
    const req = {
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: 'You are an assistant.' }],
    }

    const report = applyTokenSavers(req, 'chat', {
      enabled: false,
      cavemanLevel: 'lite',
    })

    expect(report.prompt).toBeNull()
    expect(report.rtk).toBeNull()
    expect(report.notes).toContain('token savers disabled')
  })
})
