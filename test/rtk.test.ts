import { describe, expect, it } from 'vitest'
import {
  compressText,
  createRtkStats,
  autoDetectFilter,
  resolveFilter,
  safeApply,
  gitDiff,
  gitStatus,
  gitLog,
  grep,
  find,
  ls,
  tree,
  dedupLog,
  buildOutput,
} from '../src/rtk'
import { decidePostTool } from '../src/strategies/tool-result-trim'
import { resolveConfig } from '../src/config'

describe('RTK Filters', () => {
  it('gitDiff compacts multi-hunk diffs and reports truncated lines', () => {
    const lines = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcdef 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,5 +1,150 @@',
    ]
    for (let i = 0; i < 150; i++) {
      lines.push(`+ const line${i} = ${i};`)
    }
    const rawDiff = lines.join('\n')
    const compacted = gitDiff(rawDiff, 50)
    expect(compacted).toContain('foo.ts')
    expect(compacted).toContain('lines truncated')
    expect(compacted).toContain('[full diff: rtk git diff --no-compact]')
    expect(compacted.length).toBeLessThan(rawDiff.length)
  })

  it('gitStatus formats porcelain and clean working tree', () => {
    const clean = gitStatus('## main...origin/main')
    expect(clean).toContain('Clean working tree')

    const dirty = [
      '## feat/tokens...origin/feat/tokens [ahead 1]',
      ' M src/index.ts',
      '?? new-file.txt',
    ].join('\n')
    const formatted = gitStatus(dirty)
    expect(formatted).toContain('branch: feat/tokens')
    expect(formatted).toContain('modified (1):')
    expect(formatted).toContain('untracked (1):')
  })

  it('gitLog compacts commit records to one-liners', () => {
    const raw = [
      'commit 0123456789abcdef0123456789abcdef01234567',
      'Author: Developer <dev@example.com>',
      'Date:   Sun Oct 18 20:00:00 2026 +0800',
      '',
      '    Implement token saver plugin',
      '',
      'commit 123456789abcdef0123456789abcdef012345678',
      'Author: Developer <dev@example.com>',
      'Date:   Sun Oct 18 21:00:00 2026 +0800',
      '',
      '    Add unit tests for RTK',
    ].join('\n')
    const compacted = gitLog(raw)
    expect(compacted).toContain('0123456 Implement token saver plugin')
    expect(compacted).toContain('1234567 Add unit tests for RTK')
    expect(compacted.length).toBeLessThan(raw.length)
  })

  it('grep groups hits by file and summarizes omissions', () => {
    const lines: string[] = []
    for (let i = 1; i <= 30; i++) {
      lines.push(`src/foo.ts:${i}:console.log("hit ${i}")`)
    }
    const raw = lines.join('\n')
    const compacted = grep(raw, 5)
    expect(compacted).toContain('src/foo.ts (30 hits):')
    expect(compacted).toContain('and 25 more matches')
    expect(compacted).toContain('[total: 30 matches across 1 files, 25 omitted]')
    expect(compacted.length).toBeLessThan(raw.length)
  })

  it('find groups files by directory and shows totals', () => {
    const files: string[] = []
    for (let i = 0; i < 40; i++) {
      files.push(`packages/core/src/file_${i}.ts`)
    }
    const raw = files.join('\n')
    const compacted = find(raw, 5, 10)
    expect(compacted).toContain('packages/core/src/ (40 files):')
    expect(compacted).toContain('and 35 more files')
    expect(compacted).toContain('[total: 40 files across 1 directories, 35 omitted]')
    expect(compacted.length).toBeLessThan(raw.length)
  })

  it('ls omits noise directories', () => {
    const raw = ['src', 'package.json', 'node_modules', '.git', 'dist'].join('\n')
    const compacted = ls(raw)
    expect(compacted).toContain('src')
    expect(compacted).toContain('package.json')
    expect(compacted).not.toContain('node_modules\n')
    expect(compacted).toContain('omitted 3 noise directory entries')
  })

  it('tree truncates deep directory trees', () => {
    const lines = ['├── a', '├── b']
    for (let i = 0; i < 50; i++) {
      lines.push(`│   ├── nested_${i}`)
    }
    const raw = lines.join('\n')
    const compacted = tree(raw, 10)
    expect(compacted).toContain('tree lines omitted')
    expect(compacted.length).toBeLessThan(raw.length)
  })

  it('dedupLog collapses repeating log bursts', () => {
    const lines = [
      'Starting service...',
      'Heartbeat OK',
      'Heartbeat OK',
      'Heartbeat OK',
      'Heartbeat OK',
      'Service ready.',
    ]
    const raw = lines.join('\n')
    const compacted = dedupLog(raw)
    expect(compacted).toContain('Heartbeat OK')
    expect(compacted).toContain('[repeated 3 more times]')
    expect(compacted).toContain('Service ready.')
  })

  it('buildOutput separates errors and warnings and preserves summary', () => {
    const lines = [
      'Compiling src/index.ts...',
      'error TS2322: Type number is not assignable to type string',
      'warning TS6133: unused variable x',
      'Build failed with 1 error.',
    ]
    const raw = lines.join('\n')
    const compacted = buildOutput(raw)
    expect(compacted).toContain('errors (1):')
    expect(compacted).toContain('warnings (1):')
    expect(compacted).toContain('summary:')
  })
})

describe('RTK Engine Autodetection & Invariants', () => {
  it('detects gitLog before other formats', () => {
    const raw = 'commit 0123456789abcdef0123456789abcdef01234567\nAuthor: A\nDate: D\n\n  msg'
    const filter = autoDetectFilter(raw)
    expect(filter?.filterName).toBe('git-log')
  })

  it('detects gitDiff by git diff header', () => {
    const raw = 'diff --git a/a b/b\n--- a/a\n+++ b/b\n@@ -1 +1 @@\n-a\n+b'
    const filter = autoDetectFilter(raw)
    expect(filter?.filterName).toBe('git-diff')
  })

  it('detects gitStatus by branch header', () => {
    const raw = '## main...origin/main\n M file.ts'
    const filter = autoDetectFilter(raw)
    expect(filter?.filterName).toBe('git-status')
  })

  it('resolves aliases correctly (rg -> grep, fd -> find)', () => {
    expect(resolveFilter('rg')?.filterName).toBe('grep')
    expect(resolveFilter('ripgrep')?.filterName).toBe('grep')
    expect(resolveFilter('fd')?.filterName).toBe('find')
  })

  it('strictly adheres to reduction rule: does not replace if not smaller', () => {
    // If output would be larger or equal, returns original text and compressed: false
    const smallText = 'hello world'
    const stats = createRtkStats()
    const res = compressText(smallText, stats)
    expect(res.compressed).toBe(false)
    expect(res.text).toBe(smallText)
    expect(stats.saved).toBe(0)
  })

  it('fails open when filter throws', () => {
    const throwingFilter = (() => {
      throw new Error('boom')
    }) as unknown as typeof gitDiff
    throwingFilter.filterName = 'throwing'
    const res = safeApply(throwingFilter, 'some text')
    expect(res).toBe('some text')
  })

  it('integrates with decidePostTool when rtkEnabled=true', () => {
    const cfg = resolveConfig({
      mode: 'conservative',
      rtkEnabled: true,
      headBytes: 50,
      tailBytes: 50,
    })
    const diffLines = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,5 +1,200 @@',
    ]
    for (let i = 0; i < 200; i++) {
      diffLines.push(`+ export const v${i} = ${i};`)
    }
    const rawDiff = diffLines.join('\n')

    const res = decidePostTool(
      {
        exec: { id: 'call_1', tool: { name: 'bash' } },
        result: { content: [{ type: 'text', text: rawDiff }] },
      },
      { config: cfg },
    )

    expect(res.folded).toBe(true)
    expect(res.trimmedBytes).toBeLessThan(res.originalBytes)
    const outText = res.decision.content?.[0]?.text ?? ''
    expect(outText).toContain('foo.ts')
  })

  it('preserves error tool results verbatim without RTK compaction', () => {
    const cfg = resolveConfig({
      mode: 'aggressive',
      rtkEnabled: true,
    })
    const longErr = 'Error: failure\n' + '  at line x\n'.repeat(500)
    const res = decidePostTool(
      {
        exec: { id: 'call_1', tool: { name: 'bash' } },
        result: { isError: true, content: [{ type: 'text', text: longErr }] },
      },
      { config: cfg },
    )
    expect(res.folded).toBe(false)
    expect(res.originalBytes).toBe(0)
  })
})
