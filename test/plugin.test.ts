import { describe, expect, it, vi } from 'vitest'
import { Context, resolveConfig as cordisResolveConfig, ValidationError } from '@deepseek-ai/cordis'
import * as plugin from '../src/index'
import { apply, name, Config, inject } from '../src/index'
import type { GenerateOptionsLike, StreamChunkLike } from '../src/types'

function createScope() {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  return {
    listeners,
    effects,
    on: vi.fn((event: string, listener: (...args: readonly unknown[]) => unknown) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(listener)
    }),
    effect: vi.fn((action: () => void | (() => void)) => {
      const disposer = action()
      if (typeof disposer === 'function') {
        effects.push(disposer)
      }
    }),
    get: vi.fn((key: string) => {
      if (key === 'compaction') return { stub: true }
      if (key === 'tokenMeter') return undefined
      if (key === 'systemPrompt') return undefined
      if (key === 'agents') return undefined
      if (key === 'sessions') return undefined
      return undefined
    }),
    registry: { register: vi.fn(), replace: vi.fn() },
  }
}

describe('plugin entry & Cordis registration', () => {
  it('exports name, Config, inject', () => {
    expect(name).toBe('dsh-token-saver')
    expect(typeof Config).toBe('object')
    expect(Array.isArray(inject)).toBe(true)
    expect(inject).toContain('tools')
    expect(inject).not.toContain('compaction')
  })

  it('conforms to Standard Schema v1 on Config', () => {
    expect(Config['~standard']).toBeDefined()
    expect(Config['~standard'].version).toBe(1)
    expect(Config['~standard'].vendor).toBe('dsh-token-saver')
    expect(typeof Config['~standard'].validate).toBe('function')
  })

  it('resolves config via Cordis resolveConfig without validate errors', () => {
    const resolved = cordisResolveConfig(plugin as never, { mode: 'conservative' })
    expect(resolved).toEqual({ mode: 'conservative' })

    const empty = cordisResolveConfig(plugin as never, undefined)
    expect(empty).toEqual({})

    expect(() => cordisResolveConfig(plugin as never, 'not-an-object')).toThrow(ValidationError)
  })

  it('initializes and activates cleanly inside a Cordis Context', async () => {
    const ctx = new Context()
    ctx.provide('tools', true)
    const fiber = await ctx.plugin(plugin, { mode: 'conservative' })
    expect(fiber).toBeDefined()
  })

  it('registers tools/post-execute, agent/pre-step, and llm/stream listeners', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })
    expect(scope.listeners.has('tools/post-execute')).toBe(true)
    expect(scope.listeners.has('agent/pre-step')).toBe(true)
    expect(scope.listeners.has('llm/stream')).toBe(true)
  })

  it('throws on invalid scope', async () => {
    await expect(apply({} as never, {} as never)).rejects.toThrow(/invalid Cordis scope/)
  })

  it('records an effect disposer', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'off' })
    expect(scope.effects.length).toBeGreaterThanOrEqual(1)
  })

  it('does not log unloading on activation, only logs when disposed', async () => {
    const ctx = new Context()
    ctx.provide('tools', true)
    const logs: string[] = []
    const infoSpy = vi.spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })
    try {
      const fiber = ctx.plugin(plugin, { mode: 'conservative' })
      await Promise.resolve()
      expect(logs.some((l) => l.includes('unloading plugin'))).toBe(false)

      await fiber.dispose()
      expect(logs.some((l) => l.includes('unloading plugin'))).toBe(true)
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('does not replace compaction in conservative mode', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })
    expect(scope.registry.replace).not.toHaveBeenCalled()
  })

  it('replaces compaction in aggressive mode when replaceBasicCompaction=true', async () => {
    const scope = createScope()
    await apply(scope, {
      mode: 'aggressive',
      replaceBasicCompaction: true,
      llmSummaryEnabled: true,
    })
    expect(scope.registry.replace).toHaveBeenCalledWith('compaction', expect.anything())
  })
})

describe('plugin global hooks execution', () => {
  it('intercepts local responses in llm/stream waterfall without calling next()', async () => {
    const scope = createScope()
    await apply(scope, {
      mode: 'conservative',
      localResponsesEnabled: true,
    })

    const streamListener = scope.listeners.get('llm/stream')?.[0] as (
      opts: GenerateOptionsLike,
      next: () => AsyncIterable<StreamChunkLike>,
    ) => AsyncIterable<StreamChunkLike>

    expect(streamListener).toBeDefined()

    const quotaOpts: GenerateOptionsLike = {
      messages: [{ role: 'user', content: '12345' }],
    }
    async function* dummyNext() {
      yield { type: 'finish', reason: 'stop' } as StreamChunkLike
    }
    const nextMock = vi.fn(dummyNext)

    const stream = streamListener(quotaOpts, nextMock)
    const chunks: StreamChunkLike[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(nextMock).not.toHaveBeenCalled()
    expect(chunks.some(c => c.type === 'text-delta' && c.delta === '1')).toBe(true)
  })

  it('bypasses llm/stream to next() when localResponses is disabled', async () => {
    const scope = createScope()
    await apply(scope, {
      mode: 'conservative',
      localResponsesEnabled: false,
    })

    const streamListener = scope.listeners.get('llm/stream')?.[0] as (
      opts: GenerateOptionsLike,
      next: () => AsyncIterable<StreamChunkLike>,
    ) => AsyncIterable<StreamChunkLike>

    const quotaOpts: GenerateOptionsLike = {
      messages: [{ role: 'user', content: '12345' }],
    }
    async function* dummyNext() {
      yield { type: 'text-delta', delta: 'from-upstream' } as StreamChunkLike
    }
    const nextMock = vi.fn(dummyNext)

    const stream = streamListener(quotaOpts, nextMock)
    const chunks: StreamChunkLike[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(nextMock).toHaveBeenCalled()
    expect(chunks.some(c => c.type === 'text-delta' && c.delta === 'from-upstream')).toBe(true)
  })

  it('injects prompt shaping into system prompt in llm/stream waterfall', async () => {
    const scope = createScope()
    await apply(scope, {
      mode: 'conservative',
      cavemanLevel: 'lite',
      ponytailLevel: 'full',
    })

    const streamListener = scope.listeners.get('llm/stream')?.[0] as (
      opts: GenerateOptionsLike,
      next: () => AsyncIterable<StreamChunkLike>,
    ) => AsyncIterable<StreamChunkLike>

    const opts: GenerateOptionsLike = {
      system: 'Base system prompt.',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    async function* dummyNext() {
      yield { type: 'finish', reason: 'stop' } as StreamChunkLike
    }
    const nextMock = vi.fn(dummyNext)

    const stream = streamListener(opts, nextMock)
    for await (const _ of stream) {
      // consume
    }

    expect(nextMock).toHaveBeenCalled()
    expect(opts.system).toContain('Base system prompt.')
    expect(opts.system).toContain('<!-- dsh-token-saver:prompt-shaping -->')
    expect(opts.system).toContain('Never simplify away: input validation at trust boundaries')
  })

  it('fails open in llm/stream if shaping throws', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const streamListener = scope.listeners.get('llm/stream')?.[0] as (
      opts: GenerateOptionsLike,
      next: () => AsyncIterable<StreamChunkLike>,
    ) => AsyncIterable<StreamChunkLike>

    async function* dummyNext() {
      yield { type: 'finish', reason: 'stop' } as StreamChunkLike
    }
    const nextMock = vi.fn(dummyNext)

    // Pass invalid options object to trigger safe handling
    const stream = streamListener(null as never, nextMock)
    for await (const _ of stream) {
      // consume
    }
    expect(nextMock).toHaveBeenCalled()
  })
})
