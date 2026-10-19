import { describe, expect, it } from 'vitest'
import { stabilizeForCache } from '../src/strategies/prompt-cache'
import { resolveConfig } from '../src/config'
import type { SystemPromptSection } from '../src/types'

const sampleSections = (): readonly SystemPromptSection[] => [
  { id: 'agent-identity', content: ['agent identity'], position: 0, cacheable: true },
  { id: 'user-instructions', content: ['user instructions'], position: 1, cacheable: true },
  { id: 'time-context', content: ['now'], position: 2, cacheable: false },
  { id: 'tool-list', content: ['tool list'], position: 3, cacheable: true },
  { id: 'workspace-notes', content: ['workspace notes'], position: 4, cacheable: false },
]

describe('stabilizeForCache', () => {
  it('passes through when mode is off', () => {
    const cfg = resolveConfig({ mode: 'off' })
    const out = stabilizeForCache({ sections: sampleSections(), config: cfg })
    expect(out.reordered).toBe(false)
  })

  it('moves volatile sections to the end', () => {
    const cfg = resolveConfig({ mode: 'conservative' })
    const out = stabilizeForCache({ sections: sampleSections(), config: cfg })
    expect(out.reordered).toBe(true)
    expect((out.sections[0] as SystemPromptSection).id).toBe('agent-identity')
    const lastTwo = out.sections.slice(-2).map((s) => s.id)
    expect(lastTwo).toContain('time-context')
    expect(lastTwo).toContain('workspace-notes')
  })

  it('pins stable section ids before other cacheable ones', () => {
    const cfg = resolveConfig({ mode: 'balanced', cacheStableSections: ['tool-list'] })
    const out = stabilizeForCache({ sections: sampleSections(), config: cfg })
    const cacheable = out.sections.filter((s) => s.cacheable)
    expect(cacheable[0]?.id).toBe('tool-list')
  })
})
