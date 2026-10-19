import { describe, expect, it } from 'vitest'
import { decidePreStep } from '../src/strategies/context-pressure'
import type { PreStepDecisionLike, PreStepPayloadLike, TokenMeterLike, CompactionEngineLike, AgentLike } from '../src/types'
import { resolveConfig } from '../src/config'

const basePayload = (): PreStepPayloadLike => ({
  agent: { session: { id: 'sess-1' } },
  messages: [],
  turn: 0,
  step: 0,
  signal: new AbortController().signal,
})

const enterDecision = (): PreStepDecisionLike => ({ kind: 'enter', messages: [] })

describe('decidePreStep', () => {
  it('passes through when mode is off', async () => {
    const cfg = resolveConfig({ mode: 'off' })
    let nextCalled = false
    const next = async () => {
      nextCalled = true
      return enterDecision()
    }
    const out = await decidePreStep(basePayload(), { config: cfg }, next)
    expect(nextCalled).toBe(true)
    expect(out.kind).toBe('enter')
  })

  it('passes through without calling compaction in conservative mode', async () => {
    const cfg = resolveConfig({ mode: 'conservative' })
    let compactCalled = false
    const meter: TokenMeterLike = { current: 60000, capacity: 100000, pressure: 0.6 }
    const engine: CompactionEngineLike = {
      compactIfNeeded: async () => {
        compactCalled = true
        return null
      },
      compactNow: async () => null,
      compactRegion: async () => ({}),
    }
    const next = async () => enterDecision()
    const out = await decidePreStep(basePayload(), {
      config: cfg,
      getTokenMeter: () => meter,
      getCompactionEngine: () => engine,
    }, next)
    expect(out.kind).toBe('enter')
    expect(compactCalled).toBe(false)
  })

  it('triggers compaction in balanced+ when pressure exceeds threshold and engine is available', async () => {
    const cfg = resolveConfig({ mode: 'balanced' })
    let compactCalled = false
    const meter: TokenMeterLike = { current: 80000, capacity: 100000, pressure: 0.8 }
    const engine: CompactionEngineLike = {
      compactIfNeeded: async () => {
        compactCalled = true
        return { shadowedTokenCount: 4000 } as unknown
      },
      compactNow: async () => null,
      compactRegion: async () => ({}),
    }
    const agent: AgentLike = { session: { id: 'sess-1' } }
    const telemetryEvents: unknown[] = []
    const next = async () => enterDecision()
    const out = await decidePreStep(basePayload(), {
      config: cfg,
      getTokenMeter: () => meter,
      getCompactionEngine: () => engine,
      agentForSession: () => agent,
      telemetry: { onCompact: (e) => telemetryEvents.push(e) },
    }, next)
    expect(compactCalled).toBe(true)
    expect(telemetryEvents.length).toBe(1)
    expect((telemetryEvents[0] as { trigger: string }).trigger).toBe('pressure')
    expect(out.kind).toBe('enter')
  })

  it('preserves reject decision from upstream', async () => {
    const cfg = resolveConfig({ mode: 'balanced' })
    const next = async (): Promise<PreStepDecisionLike> => ({ kind: 'reject' })
    const out = await decidePreStep(basePayload(), {
      config: cfg,
      getTokenMeter: () => ({ current: 80000, capacity: 100000, pressure: 0.8 }),
      getCompactionEngine: () => ({ compactIfNeeded: async () => null, compactNow: async () => null, compactRegion: async () => ({}) }),
    }, next)
    expect(out.kind).toBe('reject')
  })
})
