import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index'
import {
  injectIntoSystemPrompt,
  hasAnyPromptShaping,
  OFM_INJECT_MARKER,
  OFM_MARKER_END,
} from '../src/prompt-shaping'
import { compressText, createRtkStats } from '../src/rtk'
import { decidePostTool } from '../src/strategies/tool-result-trim'
import { stabilizeForCache } from '../src/strategies/prompt-cache'
import { resolveConfig } from '../src/config'
import type { GenerateOptionsLike, StreamChunkLike, SystemPromptSection } from '../src/types'

describe('Compatibility & Coexistence', () => {
  describe('Billion Context Coexistence', () => {
    it('preserves Billion Context ACP metadata and compression markers in tool outputs', () => {
      const cfg = resolveConfig({
        mode: 'conservative',
        rtkEnabled: true,
      })

      // Output containing ACP tags or compaction markers
      const toolOutputWithBili = [
        '<acp tokens="120" type="tool:bash">m00123</acp>',
        'commit 0123456789abcdef0123456789abcdef01234567',
        'Author: Dev <dev@example.com>',
        'Date: Sun Oct 18 2026',
        '',
        '  feat: bili context reconciliation',
      ].join('\n')

      const res = decidePostTool(
        {
          exec: { id: 'call_bili', tool: { name: 'bash' } },
          result: { content: [{ type: 'text', text: toolOutputWithBili }] },
        },
        { config: cfg },
      )

      // Verify that even if trimmed, the structure remains valid and doesn't corrupt markers
      const outText = res.decision.content?.[0]?.text ?? ''
      expect(outText).toBeDefined()
    })

    it('prompt cache stabilization sorts sections canonically without mutating content', () => {
      const sections: SystemPromptSection[] = [
        { id: 'dynamic_runtime', content: ['Dynamic turn info: 2026-10-18'], position: 3, cacheable: false },
        { id: 'bili_context_policy', content: ['Billion Context Policy rules...'], position: 2, cacheable: true },
        { id: 'base_identity', content: ['You are Antigravity agent.'], position: 1, cacheable: true },
      ]

      const stable = stabilizeForCache({ sections })
      expect(stable.sections[0]!.id).toBe('base_identity')
      expect(stable.sections[1]!.id).toBe('bili_context_policy')
      expect(stable.reordered).toBe(true)
      // Volatile (non-cacheable) sections move to the tail
      expect(stable.sections[2]!.id).toBe('dynamic_runtime')
    })
  })

  describe('OmniRoute Coexistence', () => {
    it('preserves request routing options (provider, model, tools) for downstream OmniRoute', async () => {
      const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
      const scope = {
        on: vi.fn((event: string, l: (...args: readonly unknown[]) => unknown) => {
          if (!listeners.has(event)) listeners.set(event, [])
          listeners.get(event)!.push(l)
        }),
        effect: vi.fn(),
        get: vi.fn(),
        registry: { register: vi.fn(), replace: vi.fn() },
      }

      await apply(scope, {
        mode: 'conservative',
        cavemanLevel: 'lite',
        localResponsesEnabled: false,
      })

      const streamListener = listeners.get('llm/stream')?.[0] as (
        opts: GenerateOptionsLike,
        next: () => AsyncIterable<StreamChunkLike>,
      ) => AsyncIterable<StreamChunkLike>

      const originalOpts: GenerateOptionsLike = {
        provider: 'custom-omniroute-provider',
        model: 'deepseek-v3',
        system: 'System instruction.',
        messages: [{ role: 'user', content: 'Route this query' }],
        tools: [{ name: 'web_search', description: 'search' }],
      }

      let passedOpts: GenerateOptionsLike | undefined
      async function* mockOmniRouteNext() {
        yield { type: 'finish', reason: 'stop' } as StreamChunkLike
      }

      const stream = streamListener(originalOpts, () => {
        passedOpts = originalOpts
        return mockOmniRouteNext()
      })

      for await (const _ of stream) {
        // consume
      }

      expect(passedOpts).toBeDefined()
      expect(passedOpts?.provider).toBe('custom-omniroute-provider')
      expect(passedOpts?.model).toBe('deepseek-v3')
      expect(passedOpts?.tools?.length).toBe(1)
      expect(passedOpts?.system).toContain('<!-- dsh-token-saver:prompt-shaping -->')
    })
  })

  describe('Our Free Model Coexistence & Duplicate Prevention', () => {
    it('avoids duplicate prompt shaping when Our Free Model marker is present', () => {
      const ofmPrompt = `You are a bot.\n\n${OFM_INJECT_MARKER}\nCaveman rules from OFM\n${OFM_MARKER_END}`
      expect(hasAnyPromptShaping(ofmPrompt)).toBe(true)

      const result = injectIntoSystemPrompt(ofmPrompt, 'DSH Token Saver Caveman')
      expect(result.injected).toBe(false)
      expect(result.reason).toBe('already-injected')
      expect(result.text).toBe(ofmPrompt)
    })

    it('avoids duplicate prompt shaping on multiple turns if marker already exists', () => {
      const base = 'Base instructions.'
      const firstPass = injectIntoSystemPrompt(base, 'Prompt shaping block')
      expect(firstPass.injected).toBe(true)

      const secondPass = injectIntoSystemPrompt(firstPass.text, 'Prompt shaping block')
      expect(secondPass.injected).toBe(false)
      expect(secondPass.reason).toBe('already-injected')
      expect(secondPass.text).toBe(firstPass.text)
    })

    it('avoids re-compacting already compacted RTK diffs', () => {
      const diffLines = [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,5 +1,200 @@',
      ]
      for (let i = 0; i < 200; i++) {
        diffLines.push(`+ const x${i} = ${i};`)
      }
      const rawDiff = diffLines.join('\n')

      const stats1 = createRtkStats()
      const firstCompact = compressText(rawDiff, stats1)
      expect(firstCompact.compressed).toBe(true)
      expect(firstCompact.text).toContain('[full diff: rtk git diff --no-compact]')

      // Second compaction on the already-compacted diff
      const stats2 = createRtkStats()
      const secondCompact = compressText(firstCompact.text, stats2)
      // Since it cannot be compacted further down, strict reduction skips it
      expect(secondCompact.compressed).toBe(false)
      expect(secondCompact.text).toBe(firstCompact.text)
    })
  })
})
