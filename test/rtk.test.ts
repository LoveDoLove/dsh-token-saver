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
  table,
  mergeRtkStats,
  compressMessages,
} from '../src/rtk'
import { decidePostTool } from '../src/strategies/tool-result-trim'
import { resolveConfig } from '../src/config'
import { RTK_DIFF_MARKER } from '../src/rtk/constants'

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

  it('table compacts large table-like CLI output keeping head and tail rows', () => {
    const lines = ['CONTAINER ID IMAGE COMMAND STATUS PORTS NAMES']
    for (let i = 0; i < 40; i++) {
      lines.push(`a${i} nginx:latest "sh" "Up 2h" 80/tcp web${i}`)
    }
    const raw = lines.join('\n')
    const out = table(raw)
    expect(out).toContain('CONTAINER ID')
    expect(out).toContain('web1')
    expect(out).toContain('web38')
    expect(out).toContain('rows omitted')
    expect(out.length).toBeLessThan(raw.length)
    const small = ['CONTAINER ID IMAGE', 'a1 nginx:latest "sh"'].join('\n')
    expect(table(small)).toBe(small)
  })

  it('autoDetectFilter routes docker-ps-like table output to the table filter', () => {
    const dockerPs = [
      'CONTAINER ID IMAGE COMMAND CREATED STATUS PORTS NAMES',
      'a3f9b2c1d4e5 nginx:latest "sh -c nginx" 2 hours ago Up 2 hours 80/tcp web1',
      'b4a9b2c1d4e5 redis:7 "redis-server" 2 hours ago Up 2 hours 6379/tcp cache1',
      'c5a9b2c1d4e5 node:22 "npm start" 2 hours ago Up 2 hours 3000/tcp api1',
      'd6a9b2c1d4e5 postgres:16 "postgres" 2 hours ago Up 2 hours 5432/tcp db1',
      'e7a9b2c1d4e5 node:22 "npm start" 2 hours ago Up 2 hours 3001/tcp api2',
    ].join('\n')
    const filter = autoDetectFilter(dockerPs)
    expect(filter?.filterName).toBe('table')
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

  it('does not classify indented text as porcelain status', () => {
    // Regression: the XY test admitted a bare space, so every line indented by
    // four or more spaces (`'  '` at columns 0-1, `' '` at column 2) read as a
    // porcelain entry — indented code, quoted mail and nested YAML were all
    // crushed by gitStatus.
    const indented = Array.from({ length: 60 }, (_, i) => `    const value${i} = compute(${i})`).join('\n')
    const filter = autoDetectFilter(indented)
    expect(filter?.filterName).not.toBe('git-status')

    // Real porcelain still carries at least one status letter per listed
    // entry. No `## ` header here, so this reaches the porcelain path itself
    // rather than short-circuiting on the branch-header rule above it.
    const real = 'M  a.ts\nMM b.ts\n D c.ts\n?? d.ts\nA  e.ts'
    expect(autoDetectFilter(real)?.filterName).toBe('git-status')
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

  it('does not fold Markdown read by a read-like tool (B1 regression)', () => {
    // Regression: autodetection sampled the first 1024 bytes and treated any
    // `## ` heading as a git-status branch header, so `read`ing a README
    // replaced the whole file with "branch: X / Clean working tree" and still
    // recorded the destruction as bytes saved. Read-like tool output is an
    // arbitrary file body, so only an explicit filter may touch it.
    const cfg = resolveConfig({
      mode: 'aggressive',
      rtkEnabled: true,
      headBytes: 50,
      tailBytes: 50,
    })
    const readme = [
      '# Project',
      '',
      '## Contributing',
      '',
      'All contributions are welcome; please open an issue first.',
      '',
      '## Setup',
      '',
      'Install the dependencies, then run the build before testing.',
      '',
      '## License',
      '',
      'MIT',
    ].join('\n')
    expect(readme.length).toBeGreaterThan(100)
    // Sanity: the detector alone would still misfire on this text.
    expect(autoDetectFilter(readme)?.filterName).toBe('git-status')

    const res = decidePostTool(
      {
        exec: { id: 'call_1', tool: { name: 'read' } },
        result: { content: [{ type: 'text', text: readme }] },
      },
      { config: cfg },
    )

    const outText = res.decision.content?.[0]?.text ?? ''
    expect(outText).toContain('## Contributing')
    expect(outText).not.toContain('Clean working tree')
    expect(res.folded).toBe(false)
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

describe('llm/stream stream stats merge', () => {
  const makeGitLogBody = () => {
    const lines = ['commit 0123456789abcdef0123456789abcdef01234567']
    for (let i = 0; i < 80; i++) {
      lines.push('commit 000000000000000000000000000000000000000' + String(i % 10))
      lines.push('Author: Developer <dev@example.com>')
      lines.push('Date:   Sun Oct 18 20:00:00 2026 +0800')
      lines.push('    fix: sample commit ' + i)
    }
    return {
      messages: [
        { role: 'user', content: 'summarize the log' },
        { role: 'tool', content: lines.join('\n') },
      ],
    }
  }

  it('compressMessages reports only actual hits in its returned stats', () => {
    const body = makeGitLogBody()
    const stats = compressMessages(body, { enabled: true })
    expect(stats).not.toBeNull()
    expect(stats!.hits.length).toBe(1)
    expect(stats!.saved).toBeGreaterThan(0)
    expect(stats!.bytesAfter).toBeLessThan(stats!.bytesBefore)
    // message payload itself was compacted (11957 -> 5997 with 80 one-line commits)
    const msg = (body as { messages: { role: string; content: string }[] }).messages[1]!
    expect(msg?.content).toContain('0123456')
    expect(msg?.content.length).toBeLessThan(6100)
  })

  it('does not re-compact already-compacted diff output (F2 cascade)', () => {
    // Regression: gitDiff stamped its marker only when it truncated a hunk, so
    // a lossless restructure left no trace of the first pass. The second pass
    // (llm/stream over the whole payload) then re-detected the header-less
    // hunks as generic text and truncated the wreckage again.
    const lines: string[] = []
    for (let i = 0; i < 900; i++) {
      lines.push(
        `diff --git a/f${i}.ts b/f${i}.ts`,
        `--- a/f${i}.ts`,
        `+++ b/f${i}.ts`,
        '@@ -1,3 +1,4 @@',
        `+ export const v${i} = ${i}`,
        ' x',
      )
    }
    const raw = lines.join('\n')

    const first = compressText(raw, createRtkStats())
    expect(first.compressed).toBe(true)
    expect(first.filterUsed).toBe('git-diff')
    // The compaction must be recognisable as such.
    expect(first.text).toContain(RTK_DIFF_MARKER)

    const body = { messages: [{ role: 'tool', content: first.text }] }
    const stats = compressMessages(body, { enabled: true })
    expect(stats?.hits.length ?? 0).toBe(0)
    expect(body.messages[0]!.content).toBe(first.text)
    // The bulk of the diff survives to the model.
    expect(Buffer.byteLength(body.messages[0]!.content)).toBeGreaterThan(first.text.length / 2)
  })

  it('merging stream stats into shared stats advances savings exactly once', () => {
    const shared = createRtkStats()
    const streamStats = compressMessages(makeGitLogBody(), { enabled: true })
    mergeRtkStats(shared, streamStats)
    expect(shared.saved).toBe(streamStats!.saved)
    expect(shared.bytesBefore).toBe(streamStats!.bytesBefore)
    expect(shared.bytesAfter).toBe(streamStats!.bytesAfter)
    expect(shared.hits.length).toBe(streamStats!.hits.length)

    // Re-merging the same result must not double-count.
    mergeRtkStats(shared, streamStats)
    expect(shared.saved).toBe(streamStats!.saved * 2)
    expect(shared.hits.length).toBe(streamStats!.hits.length * 2)
  })

  it('merging no-op or null stream stats changes nothing', () => {
    const shared = createRtkStats()
    const baseline = { saved: shared.saved, hits: shared.hits.length }

    // Uncompressed request: no RTK-detectable content.
    const plainStats = compressMessages(
      { messages: [{ role: 'user', content: 'plain text question with no tool output' }] },
      { enabled: true },
    )
    mergeRtkStats(shared, plainStats)
    expect(shared.saved).toBe(baseline.saved)
    expect(shared.hits.length).toBe(baseline.hits)

    mergeRtkStats(shared, null)
    mergeRtkStats(shared, undefined)
    expect(shared.saved).toBe(baseline.saved)
    expect(shared.hits.length).toBe(baseline.hits)
  })
})
