import { describe, expect, it, vi } from 'vitest'
import { Context, resolveConfig as cordisResolveConfig, ValidationError } from '@deepseek-ai/cordis'
import * as plugin from '../src/index'
import { apply, name, Config, inject } from '../src/index'
import type { GenerateOptionsLike, StreamChunkLike, ToolExecutionLike, ToolResultLike, PostToolDecision } from '../src/types'

function createScope() {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  const sections: Array<{
    name: string
    order: number
    text: string | (() => string)
    interpolate?: boolean
  }> = []
  const scoped = {
    systemPrompt: {
      section: vi.fn((section: (typeof sections)[number]) => {
        sections.push(section)
        return () => {}
      }),
    },
    effect: vi.fn((action: () => void | (() => void)) => {
      const disposer = action()
      if (typeof disposer === 'function') effects.push(disposer)
    }),
  }
  return {
    listeners,
    effects,
    sections,
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
    inject: vi.fn((_deps: readonly string[], callback: (s: typeof scoped) => void) => {
      callback(scoped)
    }),
    get: vi.fn((key: string) => {
      if (key === 'compaction') return { stub: true }
      if (key === 'tokenMeter') return undefined
      if (key === 'systemPrompt') return undefined
      if (key === 'agents') return undefined
      if (key === 'sessions') return undefined
      return undefined
    }),
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

  it('fails loudly on an invalid config value', () => {
    expect(() => cordisResolveConfig(plugin as never, { mode: 'reckless' })).toThrow(ValidationError)
    expect(() => cordisResolveConfig(plugin as never, { cavemanLevel: 'nope' })).toThrow(ValidationError)
    expect(() => cordisResolveConfig(plugin as never, { headBytes: -1 })).toThrow(ValidationError)
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

  it('does not warn about compaction in conservative mode', async () => {
    const scope = createScope()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await apply(scope, { mode: 'conservative' })
      expect(warn.mock.calls.some((args) => args.map(String).join(' ').includes('replaceBasicCompaction'))).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('warns instead of mutating ctx.compaction when replaceBasicCompaction=true', async () => {
    const scope = createScope()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await apply(scope, {
        mode: 'aggressive',
        replaceBasicCompaction: true,
        llmSummaryEnabled: true,
      })
      expect(warn.mock.calls.some((args) => args.map(String).join(' ').includes('replaceBasicCompaction'))).toBe(true)
      // The compaction seam is provider-owned; this plugin must not swap it.
      expect(scope.get('compaction')).toEqual({ stub: true })
    } finally {
      warn.mockRestore()
    }
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
      maxTokens: 1,
      messages: [{ role: 'user', content: 'quota' }],
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
    expect(chunks.some(c => c.type === 'text-delta' && c.text === 'Quota check passed.')).toBe(true)
    // The upstream model is never called: the usage chunk reports the REAL
    // consumption of the turn, which is zero.
    const usage = chunks.find(c => c.type === 'usage') as { usage?: Record<string, number> } | undefined
    expect(usage?.usage?.inputTokens).toBe(0)
    expect(usage?.usage?.outputTokens).toBe(0)
    expect(usage?.usage?.totalTokens).toBe(0)
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

  it('registers prompt shaping as a system-prompt section', async () => {
    const scope = createScope()
    await apply(scope, {
      mode: 'conservative',
      cavemanLevel: 'lite',
      ponytailLevel: 'full',
    })

    const section = scope.sections.find((s) => s.name === 'token-saver:prompt-shaping')
    expect(section).toBeDefined()
    expect(section?.order).toBe(9500)
    expect(section?.interpolate).toBe(false)

    const text = typeof section?.text === 'function' ? section.text() : section?.text
    expect(text).toContain('Never simplify away: input validation at trust boundaries')
  })

  it('emits no shaping text when both levels are off', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const section = scope.sections.find((s) => s.name === 'token-saver:prompt-shaping')
    const text = typeof section?.text === 'function' ? section.text() : section?.text
    expect(text).toBe('')
  })

  it('passes llm/stream options through untouched', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative', cavemanLevel: 'lite' })

    const streamListener = scope.listeners.get('llm/stream')?.[0] as (
      opts: GenerateOptionsLike,
      next: () => AsyncIterable<StreamChunkLike>,
    ) => AsyncIterable<StreamChunkLike>

    const opts: GenerateOptionsLike = {
      system: 'Base system prompt.',
      messages: [{ role: 'user', content: 'Hello' }],
    }
    const frozen = Object.freeze(opts)

    async function* dummyNext() {
      yield { type: 'finish', reason: 'stop' } as StreamChunkLike
    }
    const nextMock = vi.fn(dummyNext)

    const stream = streamListener(frozen, nextMock)
    for await (const _ of stream) {
      // consume
    }

    expect(nextMock).toHaveBeenCalled()
    expect(opts.system).toBe('Base system prompt.')
  })

  it('fails open in llm/stream for a null options object', async () => {
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

    const stream = streamListener(null as never, nextMock)
    for await (const _ of stream) {
      // consume
    }
    expect(nextMock).toHaveBeenCalled()
  })
})

describe('tools/post-execute waterfall hook', () => {
  it('handles standard DSH 3-argument signature (exec, result, next)', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const postToolListener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: ToolExecutionLike,
      result: ToolResultLike,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    expect(postToolListener).toBeDefined()

    const exec: ToolExecutionLike = { id: 'call_1', name: 'read' }
    const result: ToolResultLike = { content: [{ type: 'text', text: 'normal result' }] }
    const nextMock = vi.fn(async () => ({ kind: 'accept' as const }))

    const decision = await postToolListener(exec, result, nextMock)

    expect(nextMock).toHaveBeenCalled()
    expect(decision.kind).toBe('accept')
  })

  it('regression: calls next() and does not throw "next is not a function" when passed 3 arguments', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const postToolListener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: ToolExecutionLike,
      result: ToolResultLike,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    const exec: ToolExecutionLike = { id: 'call_2', name: 'read' }
    const big = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join('\n')
    const result: ToolResultLike = { content: [{ type: 'text', text: big }] }
    const nextMock = vi.fn(async () => ({ kind: 'accept' as const }))

    // This must NOT throw TypeError: next is not a function!
    const decision = await postToolListener(exec, result, nextMock)

    expect(nextMock).toHaveBeenCalled()
    expect(decision.kind).toBe('accept')
    expect(Array.isArray(decision.content)).toBe(true)
  })

  it('handles backward-compatible 2-argument signature ({ exec, result }, next)', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const postToolListener = scope.listeners.get('tools/post-execute')?.[0] as (
      payload: { exec?: ToolExecutionLike; result?: ToolResultLike },
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    const payload = {
      exec: { id: 'call_3', name: 'read' },
      result: { content: [{ type: 'text', text: 'small text' }] },
    }
    const nextMock = vi.fn(async () => ({ kind: 'accept' as const }))

    const decision = await postToolListener(payload, nextMock)

    expect(nextMock).toHaveBeenCalled()
    expect(decision.kind).toBe('accept')
  })

  it('defensively falls back when next argument is missing', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const postToolListener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: ToolExecutionLike,
      result: ToolResultLike,
    ) => Promise<PostToolDecision>

    const exec: ToolExecutionLike = { id: 'call_4', name: 'read' }
    const result: ToolResultLike = { content: [{ type: 'text', text: 'small text' }] }

    const decision = await postToolListener(exec, result)
    expect(decision.kind).toBe('accept')
  })

  it('preserves isError results untouched', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })

    const postToolListener = scope.listeners.get('tools/post-execute')?.[0] as (
      exec: ToolExecutionLike,
      result: ToolResultLike,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>

    const exec: ToolExecutionLike = { id: 'call_5', name: 'read' }
    const result: ToolResultLike = {
      isError: true,
      content: [{ type: 'text', text: 'A'.repeat(50000) }],
    }
    const nextMock = vi.fn(async () => ({ kind: 'accept' as const }))

    const decision = await postToolListener(exec, result, nextMock)
    expect(nextMock).toHaveBeenCalled()
    // Not folded because isError: true
    expect(decision.content).toBeUndefined()
  })
})
