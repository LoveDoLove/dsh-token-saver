import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { resolveConfig } from '../src/config'
import type { PostToolDecision, PreStepDecisionLike } from '../src/types'

interface MockScope {
  listeners: Map<string, Array<(...args: readonly unknown[]) => unknown>>
  effects: Array<() => void>
  compactionEngine: { callsToCompactIfNeeded: number; lastTrigger?: string }
  sessionEvents: Map<string, Array<{ type: string; content?: string }>>
  systemPromptRegistrations: Array<(input: unknown) => unknown>
  replacedKeys: Array<string>
  tokenMeter: Map<string, { current: number; capacity: number; pressure: number }>
  foldTelemetry: Array<{ toolName?: string; originalBytes: number; trimmedBytes: number }>
  compactTelemetry: Array<{ trigger: string; engine: string }>
  on(event: string, listener: (...args: readonly unknown[]) => unknown): void
  effect(fn: () => void): void
  get(key: string): unknown
}

function createScope(): MockScope {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  const tokenMeter = new Map<string, { current: number; capacity: number; pressure: number }>()
  const sessionEvents = new Map<string, Array<{ type: string; content?: string }>>()
  const systemPromptRegistrations: Array<(input: unknown) => unknown> = []
  const replacedKeys: Array<string> = []
  const foldTelemetry: Array<{ toolName?: string; originalBytes: number; trimmedBytes: number }> = []
  const compactTelemetry: Array<{ trigger: string; engine: string }> = []
  const compactionEngine = { callsToCompactIfNeeded: 0, lastTrigger: undefined as string | undefined }
  const scope: MockScope = {
    listeners,
    effects,
    tokenMeter,
    compactionEngine,
    sessionEvents,
    systemPromptRegistrations,
    replacedKeys,
    foldTelemetry,
    compactTelemetry,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(listener)
    },
    effect(fn) {
      effects.push(fn)
    },
    get(key) {
      if (key === 'tokenMeter') {
        return {
          for: (id: string) => tokenMeter.get(id),
        }
      }
      if (key === 'compaction') {
        return {
          compactIfNeeded: async (_agent: { session: { id: string } }, trigger: string) => {
            compactionEngine.callsToCompactIfNeeded++
            compactionEngine.lastTrigger = trigger
            return { shadowedTokenCount: 1200 }
          },
          compactNow: async () => null,
          compactRegion: async () => ({}),
        }
      }
      if (key === 'agents') {
        return { for: (id: string) => ({ session: { id, provider: 'mock', model: 'mock' } }) }
      }
      if (key === 'sessions') {
        return {
          get: (id: string) => {
            if (!sessionEvents.has(id)) sessionEvents.set(id, [])
            return { events: () => sessionEvents.get(id)! }
          },
        }
      }
      if (key === 'systemPrompt') {
        return {
          register: (fn: (input: unknown) => unknown) => {
            systemPromptRegistrations.push(fn)
          },
        }
      }
      return undefined
    },
  }
  ;(scope as unknown as { registry: { replace(k: string, v: unknown): void; register(k: string, v: unknown): void } }).registry = {
    replace(k, v) {
      replacedKeys.push(k)
      if (k === 'compaction') {
        const orig = scope.get.bind(scope)
        scope.get = ((key: string) => key === 'compaction' ? v : orig(key)) as typeof scope.get
      }
    },
    register(k) {
      replacedKeys.push(k)
    },
  }
  return scope
}

async function fire<T>(scope: MockScope, event: string, payload: unknown, upstream: T): Promise<unknown> {
  const listeners = scope.listeners.get(event) ?? []
  if (listeners.length === 0) return upstream
  const listener = listeners[listeners.length - 1]!
  return Promise.resolve(listener(payload, () => Promise.resolve(upstream)))
}

describe('local smoke — full dsh event flow with mock scope', () => {
  it('off mode is a no-op', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'off', telemetry: { onFold: (e) => scope.foldTelemetry.push(e as never) } }))
    const upstream: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: 'A'.repeat(50_000) }] }
    const out = await fire(scope, 'tools/post-execute', { exec: { tool: { name: 'read' } }, result: { content: upstream.content } }, upstream) as PostToolDecision
    const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('') : '')
    expect(outText.length).toBe(50_000)
    expect(scope.foldTelemetry.length).toBe(0)
  })

  it('conservative mode folds large tool results via tools/post-execute', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({
      mode: 'conservative',
      telemetry: { onFold: (e) => scope.foldTelemetry.push(e as never) },
    }))
    const upstream: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: 'B'.repeat(80_000) }] }
    const out = await fire(scope, 'tools/post-execute', { exec: { id: 'r', tool: { name: 'read' } }, result: { content: upstream.content } }, upstream) as PostToolDecision
    const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('') : '')
    expect(outText.length).toBeLessThan(80_000)
    expect(outText).toContain('omitted')
    expect(scope.foldTelemetry.length).toBe(1)
    expect(scope.foldTelemetry[0]?.toolName).toBe('read')
  })

  it('preserves error results verbatim', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'conservative' }))
    const huge = 'E'.repeat(80_000)
    const upstream: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: huge }] }
    const out = await fire(scope, 'tools/post-execute', { exec: { id: 'r', tool: { name: 'read' } }, result: { content: upstream.content, isError: true } }, upstream) as PostToolDecision
    const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('') : '')
    expect(outText.length).toBe(80_000)
  })

  it('conservative mode does NOT trigger ctx.compaction on pre-step', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'conservative' }))
    scope.tokenMeter.set('sess-1', { current: 80_000, capacity: 100_000, pressure: 0.8 })
    const upstream: PreStepDecisionLike = { kind: 'enter', messages: [] }
    const out = await fire(scope, 'agent/pre-step', { agent: { session: { id: 'sess-1' } }, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, upstream)
    expect(out).toEqual(upstream)
    expect(scope.compactionEngine.callsToCompactIfNeeded).toBe(0)
  })

  it('balanced mode triggers ctx.compaction on pre-step when pressure > threshold', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'balanced', telemetry: { onCompact: (e) => scope.compactTelemetry.push(e as never) } }))
    scope.tokenMeter.set('sess-2', { current: 90_000, capacity: 100_000, pressure: 0.9 })
    const upstream: PreStepDecisionLike = { kind: 'enter', messages: [] }
    const out = await fire(scope, 'agent/pre-step', { agent: { session: { id: 'sess-2' } }, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, upstream)
    expect(out).toEqual(upstream)
    expect(scope.compactionEngine.callsToCompactIfNeeded).toBe(1)
    expect(scope.compactionEngine.lastTrigger).toBe('pressure')
    expect(scope.compactTelemetry.length).toBe(1)
    expect(scope.compactTelemetry[0]?.trigger).toBe('pressure')
    expect(scope.compactTelemetry[0]?.engine).toBe('official-basic')
  })

  it('balanced mode skips compaction when pressure below threshold', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'balanced' }))
    scope.tokenMeter.set('sess-3', { current: 30_000, capacity: 100_000, pressure: 0.3 })
    const upstream: PreStepDecisionLike = { kind: 'enter', messages: [] }
    await fire(scope, 'agent/pre-step', { agent: { session: { id: 'sess-3' } }, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, upstream)
    expect(scope.compactionEngine.callsToCompactIfNeeded).toBe(0)
  })

  it('preserves reject decision from upstream at agent/pre-step', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'balanced' }))
    scope.tokenMeter.set('sess-4', { current: 99_000, capacity: 100_000, pressure: 0.99 })
    const upstream: PreStepDecisionLike = { kind: 'reject' }
    const out = await fire(scope, 'agent/pre-step', { agent: { session: { id: 'sess-4' } }, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, upstream)
    expect(out).toEqual({ kind: 'reject' })
    expect(scope.compactionEngine.callsToCompactIfNeeded).toBe(0)
  })

  it('aggressive mode replaces the compaction engine via scope.registry', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'aggressive', llmSummaryEnabled: true, replaceBasicCompaction: true }))
    expect(scope.replacedKeys).toContain('compaction')
  })

  it('conservative mode never replaces the compaction engine', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'conservative', llmSummaryEnabled: true }))
    expect(scope.replacedKeys.length).toBe(0)
  })

  it('systemPrompt register is called when systemPrompt service is exposed', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'conservative' }))
    expect(scope.systemPromptRegistrations.length).toBe(1)
    const reordered = scope.systemPromptRegistrations[0]!([
      { id: 'noise', content: ['time now'], position: 0, cacheable: false },
      { id: 'tool-list', content: ['tools'], position: 1, cacheable: true },
      { id: 'identity', content: ['who'], position: 2, cacheable: true },
    ])
    const reorderedArr = reordered as Array<{ id: string }>
    expect(reorderedArr[reorderedArr.length - 1]?.id).toBe('noise')
  })

  it('excludes tools in excludeToolNames even when content is large', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'conservative', excludeToolNames: ['protected'] }))
    const upstream: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: 'X'.repeat(80_000) }] }
    const out = await fire(scope, 'tools/post-execute', { exec: { id: 'p', tool: { name: 'protected' } }, result: { content: upstream.content } }, upstream) as PostToolDecision
    const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('') : '')
    expect(outText.length).toBe(80_000)
  })

  it('includeToolNames narrows folding to a whitelist when set', async () => {
    const scope = createScope()
    await apply(scope, resolveConfig({ mode: 'balanced', includeToolNames: ['grep'] }))
    const upstream: PostToolDecision = { kind: 'accept', content: [{ type: 'text', text: 'A'.repeat(80_000) }] }
    const out = await fire(scope, 'tools/post-execute', { exec: { id: 'r', tool: { name: 'read' } }, result: { content: upstream.content } }, upstream) as PostToolDecision
    const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('') : '')
    expect(outText.length).toBe(80_000)
  })
})
