import { describe, expect, it } from 'vitest'
import {
  cavemanPrompt,
  ponytailPrompt,
  activePrompts,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
  injectIntoSystemPrompt,
  stripPromptShaping,
  hasAnyPromptShaping,
  wrapPromptSegment,
  DSH_INJECT_MARKER,
  DSH_MARKER_END,
  OFM_INJECT_MARKER,
  OFM_MARKER_END,
} from '../src/prompt-shaping'

describe('Prompt Shaping - Caveman & Ponytail', () => {
  it('returns valid prompt string for all caveman levels', () => {
    for (const lvl of CAVEMAN_LEVELS) {
      if (lvl === 'off') {
        expect(cavemanPrompt(lvl)).toBeNull()
      } else {
        const text = cavemanPrompt(lvl)
        expect(typeof text).toBe('string')
        expect(text!.length).toBeGreaterThan(50)
      }
    }
  })

  it('returns valid prompt string for all ponytail levels', () => {
    for (const lvl of PONYTAIL_LEVELS) {
      if (lvl === 'off') {
        expect(ponytailPrompt(lvl)).toBeNull()
      } else {
        const text = ponytailPrompt(lvl)
        expect(typeof text).toBe('string')
        expect(text!.length).toBeGreaterThan(50)
        expect(text).toContain('Never simplify away: input validation at trust boundaries')
      }
    }
  })

  it('handles invalid or off levels gracefully', () => {
    expect(cavemanPrompt('off')).toBeNull()
    expect(cavemanPrompt('unknown' as never)).toBeNull()
    expect(ponytailPrompt('off')).toBeNull()
    expect(ponytailPrompt('invalid' as never)).toBeNull()
  })

  it('assembles activePrompts in canonical order (caveman then ponytail)', () => {
    const both = activePrompts({ caveman: 'full', ponytail: 'lite' })
    expect(both.length).toBe(2)
    expect(both[0]!.id).toBe('caveman')
    expect(both[1]!.id).toBe('ponytail')

    const onlyCaveman = activePrompts({ caveman: 'ultra', ponytail: 'off' })
    expect(onlyCaveman.length).toBe(1)
    expect(onlyCaveman[0]!.id).toBe('caveman')

    const onlyPonytail = activePrompts({ caveman: 'off', ponytail: 'full' })
    expect(onlyPonytail.length).toBe(1)
    expect(onlyPonytail[0]!.id).toBe('ponytail')

    const none = activePrompts({ caveman: 'off', ponytail: 'off' })
    expect(none.length).toBe(0)
  })
})

describe('Prompt Shaping - System Prompt Injection & Deduplication', () => {
  it('injects into empty or undefined system prompt', () => {
    const res = injectIntoSystemPrompt(undefined, 'Concise instruction')
    expect(res.injected).toBe(true)
    expect(res.reason).toBe('created')
    expect(res.text).toContain(DSH_INJECT_MARKER)
    expect(res.text).toContain('Concise instruction')
    expect(res.text).toContain(DSH_MARKER_END)
  })

  it('appends to existing system prompt with separator', () => {
    const base = 'You are a helpful coding assistant.'
    const res = injectIntoSystemPrompt(base, 'Concise instruction')
    expect(res.injected).toBe(true)
    expect(res.reason).toBe('appended')
    expect(res.text.startsWith(base)).toBe(true)
    expect(res.text).toContain(DSH_INJECT_MARKER)
  })

  it('prevents duplicate injection if DSH marker already exists', () => {
    const initial = injectIntoSystemPrompt('Base prompt', 'Instruction 1').text
    const second = injectIntoSystemPrompt(initial, 'Instruction 2')
    expect(second.injected).toBe(false)
    expect(second.reason).toBe('already-injected')
    expect(second.text).toBe(initial)
  })

  it('prevents duplicate injection if Our Free Model marker already exists', () => {
    const ofmInjected = `Base prompt\n\n${OFM_INJECT_MARKER}\nOFM rules\n${OFM_MARKER_END}`
    expect(hasAnyPromptShaping(ofmInjected)).toBe(true)
    const res = injectIntoSystemPrompt(ofmInjected, 'DSH rules')
    expect(res.injected).toBe(false)
    expect(res.reason).toBe('already-injected')
    expect(res.text).toBe(ofmInjected)
  })

  it('strips both DSH and OFM markers cleanly', () => {
    const textWithBoth = [
      'Base prompt',
      wrapPromptSegment('DSH segment'),
      `${OFM_INJECT_MARKER}\nOFM segment\n${OFM_MARKER_END}`,
      'Ending note',
    ].join('\n\n')

    const stripped = stripPromptShaping(textWithBoth)
    expect(stripped).toContain('Base prompt')
    expect(stripped).toContain('Ending note')
    expect(stripped).not.toContain('DSH segment')
    expect(stripped).not.toContain('OFM segment')
    expect(stripped).not.toContain(DSH_INJECT_MARKER)
    expect(stripped).not.toContain(OFM_INJECT_MARKER)
  })
})
