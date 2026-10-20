import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { StatsStore, emptyTotals, resolveStatsPath } from '../src/stats-store.js'
import { getLiveSavings } from '../src/settings.js'
import { createRtkStats, type RtkHit, type RtkStats } from '../src/rtk/index.js'

function makeStats(entries: readonly [number, number][]): RtkStats {
  const stats = createRtkStats()
  for (const [before, after] of entries) {
    const hit: RtkHit = {
      filter: 'git-status',
      originalBytes: before,
      compactedBytes: after,
      savedBytes: before - after,
    }
    stats.hits.push(hit)
    stats.bytesBefore += before
    stats.bytesAfter += after
    stats.saved += before - after
  }
  return stats
}

describe('StatsStore', () => {
  let tmpDir: string
  let statsFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-saver-stats-'))
    statsFile = path.join(tmpDir, 'nested', 'stats.json')
  })

  it('starts from zero when no stats file exists', () => {
    const store = new StatsStore(statsFile)
    expect(store.get()).toEqual(emptyTotals())
    expect(fs.existsSync(statsFile)).toBe(false)
  })

  it('separates calls from blocks across several invocations', () => {
    const store = new StatsStore(statsFile)
    store.record(makeStats([[1000, 200], [500, 100], [300, 300]]))
    store.record(makeStats([[400, 100]]))

    const totals = store.get()
    // First call compressed three blocks, second one compressed a single block.
    expect(totals.calls).toBe(2)
    expect(totals.blocks).toBe(4)
    expect(totals.bytesBefore).toBe(2200)
    expect(totals.bytesAfter).toBe(700)
    expect(totals.saved).toBe(1500)
  })

  it('records nothing when an invocation has no compression hit', () => {
    const store = new StatsStore(statsFile)
    store.record(makeStats([[1000, 200]]))
    const before = fs.readFileSync(statsFile, 'utf8')

    store.record(createRtkStats())
    store.record(null)
    store.record(undefined)

    expect(store.get().calls).toBe(1)
    expect(store.get().blocks).toBe(1)
    expect(fs.readFileSync(statsFile, 'utf8')).toBe(before)
  })

  it('restores the totals after a simulated restart', () => {
    const first = new StatsStore(statsFile)
    first.record(makeStats([[1000, 250], [300, 50]]))

    const reloaded = new StatsStore(statsFile)
    expect(reloaded.get()).toEqual(first.get())
    expect(reloaded.get().calls).toBe(1)
    expect(reloaded.get().blocks).toBe(2)
  })

  it('ignores corrupt or hostile stats files instead of throwing', () => {
    fs.mkdirSync(path.dirname(statsFile), { recursive: true })
    fs.writeFileSync(statsFile, '{ not json')

    const store = new StatsStore(statsFile)
    expect(store.get()).toEqual(emptyTotals())

    fs.writeFileSync(
      statsFile,
      JSON.stringify({ bytesBefore: -5, bytesAfter: 'x', saved: Number.NaN, calls: 2.7, blocks: null }),
    )
    expect(new StatsStore(statsFile).get()).toEqual({
      bytesBefore: 0,
      bytesAfter: 0,
      saved: 0,
      calls: 2,
      blocks: 0,
    })
  })

  it('keeps in-memory totals when the file cannot be written', () => {
    const store = new StatsStore(path.join(tmpDir, 'stats-dir-conflict'))
    // A directory at the file path makes every write fail.
    fs.mkdirSync(path.join(tmpDir, 'stats-dir-conflict'), { recursive: true })
    expect(() => store.record(makeStats([[100, 20]]))).not.toThrow()
    expect(store.get().calls).toBe(1)
    expect(store.get().blocks).toBe(1)
  })

  it('resolves its default path under the token-saver settings directory', () => {
    expect(resolveStatsPath()).toBe(path.join(process.env.DSH_HOME as string, 'token-saver', 'stats.json'))
  })
})

describe('getLiveSavings with persisted totals', () => {
  it('prefers persisted totals over the live accumulator', () => {
    const live = makeStats([[1000, 200]])
    const savings = getLiveSavings(live, { bytesBefore: 2000, bytesAfter: 500, saved: 1500, calls: 3, blocks: 4 })

    expect(savings.bytesBefore).toBe(2000)
    expect(savings.bytesAfter).toBe(500)
    expect(savings.saved).toBe(1500)
    expect(savings.percent).toBe(75)
    expect(savings.calls).toBe(3)
    expect(savings.blocks).toBe(4)
    expect(savings.promptCalls).toBe(0)
    expect(savings.summary).toContain('75%')
    expect(savings.summary).toContain('3 calls')
  })

  it('falls back to the live accumulator without persisted totals', () => {
    const savings = getLiveSavings(makeStats([[1000, 250]]))
    expect(savings.calls).toBe(1)
    expect(savings.blocks).toBe(1)
    expect(savings.percent).toBe(75)
  })

  it('reports zero percent when nothing has been compressed', () => {
    const savings = getLiveSavings(createRtkStats(), emptyTotals())
    expect(savings.saved).toBe(0)
    expect(savings.percent).toBe(0)
    expect(savings.calls).toBe(0)
    expect(savings.blocks).toBe(0)
    expect(savings.summary).toBe('')
  })
})
