import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../src/index'
import type { PostToolDecision } from '../src/types'

function createScope() {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  return {
    listeners,
    on: vi.fn((event: string, listener: (...args: readonly unknown[]) => unknown) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(listener)
    }),
    effect: vi.fn(),
    get: vi.fn(() => undefined),
    registry: { register: vi.fn(), replace: vi.fn() },
  }
}

interface Totals {
  bytesBefore: number
  bytesAfter: number
  saved: number
  calls: number
  blocks: number
}

function readTotals(file: string): Totals {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Totals
}

function gitLog(lines: number): string {
  const out = ['commit 0123456789abcdef0123456789abcdef01234567']
  for (let i = 0; i < lines; i++) {
    out.push('commit 000000000000000000000000000000000000000' + String(i % 10))
    out.push('Author: Developer <dev@example.com>')
    out.push('Date:   Sun Oct 18 20:00:00 2026 +0800')
    out.push('    fix: sample commit ' + i)
  }
  return out.join('\n')
}

describe('persisted savings telemetry', () => {
  let home: string
  let statsFile: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-saver-plugin-home-'))
    process.env.DSH_HOME = home
    statsFile = path.join(home, 'token-saver', 'stats.json')
  })

  it('persists one tool-result compression as a single call with its blocks', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })

    const listener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: unknown,
      result: unknown,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    const result = await listener(
      { id: 'x', tool: { name: 'bash' } },
      { content: [{ type: 'text', text: gitLog(80) }] },
      () => Promise.resolve({ kind: 'accept' }),
    )
    expect(result.kind).toBe('accept')

    const totals = readTotals(statsFile)
    expect(totals.calls).toBe(1)
    expect(totals.blocks).toBe(1)
    expect(totals.saved).toBeGreaterThan(0)
    expect(totals.bytesBefore).toBeGreaterThan(totals.bytesAfter)
  })

  it('counts repeated tool compressions without re-counting earlier ones', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })
    const listener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: unknown,
      result: unknown,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>
    const call = () =>
      listener(
        { id: 'x', tool: { name: 'bash' } },
        { content: [{ type: 'text', text: gitLog(80) }] },
        () => Promise.resolve({ kind: 'accept' }),
      )

    await call()
    const first = readTotals(statsFile)
    await call()
    const second = readTotals(statsFile)

    expect(second.calls).toBe(2)
    expect(second.blocks).toBe(first.blocks * 2)
    expect(second.saved).toBe(first.saved * 2)
  })

  it('records llm/stream compression into the persisted totals', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })

    const listener = scope.listeners.get('llm/stream')?.[0] as (
      options: unknown,
      next: () => AsyncIterable<unknown>,
    ) => AsyncIterable<unknown>
    const req = {
      messages: [{ role: 'tool', content: gitLog(80) }],
    }

    listener(req, () => (async function* () {})())

    const totals = readTotals(statsFile)
    expect(totals.calls).toBe(1)
    expect(totals.blocks).toBe(1)
    expect(totals.saved).toBeGreaterThan(0)
  })

  it('counts nothing when the folded result never reaches the model', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })
    const listener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: unknown,
      result: unknown,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    // Upstream keeps its own decision: the folded content is discarded, so no
    // savings may be recorded for it.
    const blocked = await listener(
      { id: 'x', tool: { name: 'bash' } },
      { content: [{ type: 'text', text: gitLog(80) }] },
      () => Promise.resolve({ kind: 'block' }),
    )
    expect(blocked.kind).toBe('block')

    const replaced = await listener(
      { id: 'y', tool: { name: 'bash' } },
      { content: [{ type: 'text', text: gitLog(80) }] },
      () => Promise.resolve({ kind: 'accept', value: { upstream: true } }),
    )
    expect(replaced.kind).toBe('accept')
    expect(fs.existsSync(statsFile)).toBe(false)
  })

  it('counts nothing for a fold that is not RTK compression', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })
    const listener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: unknown,
      result: unknown,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    // grep-like output is folded by the structural folder, not by an RTK
    // filter, so it saves bytes but has no RTK hit to report.
    const grepOut = Array.from({ length: 900 }, (_, i) => `src/file${i}.ts:${i}:const value${i} = ${i}`).join('\n')
    const decision = await listener(
      { id: 'g', tool: { name: 'grep' } },
      { content: [{ type: 'text', text: grepOut }] },
      () => Promise.resolve({ kind: 'accept' }),
    )
    expect(decision.kind).toBe('accept')
    expect(fs.existsSync(statsFile)).toBe(false)
  })

  it('writes no telemetry file when nothing compresses', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', rtkEnabled: true })
    const listener = scope.listeners.get('llm/stream')?.[0] as (
      options: unknown,
      next: () => AsyncIterable<unknown>,
    ) => AsyncIterable<unknown>

    listener({ messages: [{ role: 'user', content: 'hello there' }] }, () => (async function* () {})())

    expect(fs.existsSync(statsFile)).toBe(false)
  })

  it('restores earlier savings when the plugin is applied again', async () => {
    const first = createScope()
    await apply(first, { mode: 'conservative', rtkEnabled: true })
    const firstListener = first.listeners.get('tools/post-execute')?.[0] as (
      exec: unknown,
      result: unknown,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>
    await firstListener(
      { id: 'x', tool: { name: 'bash' } },
      { content: [{ type: 'text', text: gitLog(80) }] },
      () => Promise.resolve({ kind: 'accept' }),
    )
    const before = readTotals(statsFile)

    // A second apply simulates a host restart: totals must survive and stay put.
    const second = createScope()
    await apply(second, { mode: 'conservative', rtkEnabled: true })
    expect(JSON.parse(fs.readFileSync(statsFile, 'utf8'))).toEqual(before)
  })
})
