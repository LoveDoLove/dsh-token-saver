import { describe, expect, it } from 'vitest'
import {
  detectLocalResponse,
  createLocalResponseStream,
  extractCommandPrefix,
  shellWords,
} from '../src/local-responses'
import type { GenerateOptionsLike } from '../src/types'

describe('Local Responses - 5 Types Detection & Generation', () => {
  it('detects and handles quota probes', () => {
    // Upstream (dsh-our-free-model) gates the quota answer on a one-token
    // budget plus the word "quota". DSH spells the budget `maxTokens`.
    const opts: GenerateOptionsLike = {
      maxTokens: 1,
      messages: [{ role: 'user', content: 'quota' }],
    }
    const detected = detectLocalResponse(opts)
    expect(detected).not.toBeNull()
    expect(detected?.kind).toBe('quota')
    expect(detected?.text).toBe('Quota check passed.')
    expect(detected?.usage.input_tokens).toBe(10)
    expect(detected?.usage.output_tokens).toBe(5)
  })

  it('does not intercept a bare integer message', () => {
    // A lone integer is an ordinary user message, not a quota probe.
    const opts: GenerateOptionsLike = {
      messages: [{ role: 'user', content: '99999' }],
    }
    expect(detectLocalResponse(opts)).toBeNull()
  })

  it('does not intercept a quota question without a one-token budget', () => {
    const opts: GenerateOptionsLike = {
      messages: [{ role: 'user', content: 'how much quota is left?' }],
    }
    expect(detectLocalResponse(opts)).toBeNull()
  })

  it('detects and handles command prefix extraction', () => {
    const opts: GenerateOptionsLike = {
      messages: [
        {
          role: 'user',
          content: '<policy_spec>\nRule: allow git\n</policy_spec>\nCommand: git status',
        },
      ],
    }
    const detected = detectLocalResponse(opts)
    expect(detected).not.toBeNull()
    expect(detected?.kind).toBe('prefix')
    expect(detected?.text).toBe('git status')
    expect(detected?.usage.input_tokens).toBe(100)
    expect(detected?.usage.output_tokens).toBe(5)
  })

  it('handles command prefix edge cases: env vars, injection, two-word commands', () => {
    expect(extractCommandPrefix('git commit -m "fix"')).toBe('git commit')
    expect(extractCommandPrefix('npm test -- --coverage')).toBe('npm test')
    expect(extractCommandPrefix('VAR=1 ls -la')).toBe('VAR=1 ls')
    expect(extractCommandPrefix('VAR=1 git push origin main')).toBe('git push')
    expect(extractCommandPrefix('echo `whoami`')).toBe('command_injection_detected')
    expect(extractCommandPrefix('echo $(cat /etc/passwd)')).toBe('command_injection_detected')
    expect(extractCommandPrefix('')).toBe('none')
  })

  it('detects and handles session title requests', () => {
    // Via purpose
    const optsPurpose: GenerateOptionsLike = {
      purpose: 'session-title',
      messages: [{ role: 'user', content: 'Help me debug this memory issue' }],
    }
    const detected1 = detectLocalResponse(optsPurpose)
    expect(detected1).not.toBeNull()
    expect(detected1?.kind).toBe('title')
    expect(detected1?.text).toBe('Conversation')

    // Via system prompt heuristic
    const optsSystem: GenerateOptionsLike = {
      system: 'Generate a short sentence-case title for this conversation.',
      messages: [{ role: 'user', content: 'Hello' }],
    }
    const detected2 = detectLocalResponse(optsSystem)
    expect(detected2).not.toBeNull()
    expect(detected2?.kind).toBe('title')
  })

  it('detects and handles suggestion mode', () => {
    const opts: GenerateOptionsLike = {
      messages: [
        {
          role: 'user',
          content: 'Here is code. [SUGGESTION MODE: on]',
        },
      ],
    }
    const detected = detectLocalResponse(opts)
    expect(detected).not.toBeNull()
    expect(detected?.kind).toBe('suggestion')
    expect(detected?.text).toBe('')
    expect(detected?.usage.output_tokens).toBe(1)
  })

  it('detects and handles filepath extraction', () => {
    // Reading command (cat) extracts file paths. The trigger is the user
    // naming "filepaths" (upstream also accepts "<filepaths>").
    const optsCat: GenerateOptionsLike = {
      messages: [
        {
          role: 'user',
          content: 'Command: cat src/index.ts src/types.ts\nOutput: [file contents...]\nExtract filepaths.',
        },
      ],
    }
    const detectedCat = detectLocalResponse(optsCat)
    expect(detectedCat).not.toBeNull()
    expect(detectedCat?.kind).toBe('filepath')
    expect(detectedCat?.text).toContain('<filepaths>')
    expect(detectedCat?.text).toContain('src/index.ts')
    expect(detectedCat?.text).toContain('src/types.ts')

    // The system prompt may ask for the paths instead of the user.
    const optsSystem: GenerateOptionsLike = {
      system: 'Extract any file paths that this command touched.',
      messages: [
        {
          role: 'user',
          content: 'Command: cat src/index.ts src/types.ts\nOutput: [file contents...]',
        },
      ],
    }
    const detectedSystem = detectLocalResponse(optsSystem)
    expect(detectedSystem).not.toBeNull()
    expect(detectedSystem?.kind).toBe('filepath')
    expect(detectedSystem?.text).toContain('src/index.ts')

    // Listing command (ls) yields empty filepaths block
    const optsLs: GenerateOptionsLike = {
      messages: [
        {
          role: 'user',
          content: 'Command: ls -la /tmp\nOutput: [dir listing]\nExtract filepaths.',
        },
      ],
    }
    const detectedLs = detectLocalResponse(optsLs)
    expect(detectedLs).not.toBeNull()
    expect(detectedLs?.kind).toBe('filepath')
    expect(detectedLs?.text).toBe('<filepaths>\n</filepaths>')
  })

  it('shellWords parses quoted arguments properly', () => {
    expect(shellWords('cat "my file.txt" \'other file.ts\'')).toEqual([
      'cat',
      'my file.txt',
      'other file.ts',
    ])
  })
})

describe('Local Responses - Independent Enablement & Streaming', () => {
  it('returns null if kind is disabled in config', () => {
    const opts: GenerateOptionsLike = {
      maxTokens: 1,
      messages: [{ role: 'user', content: 'quota' }],
    }
    const detectedDisabled = detectLocalResponse(opts, { quota: false })
    expect(detectedDisabled).toBeNull()

    const detectedEnabled = detectLocalResponse(opts, { quota: true })
    expect(detectedEnabled?.kind).toBe('quota')
  })

  it('createLocalResponseStream emits proper stream chunks', async () => {
    const match = {
      kind: 'quota' as const,
      text: 'Quota check passed.',
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'test-model',
    }
    const chunks = []
    for await (const chunk of createLocalResponseStream(match)) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBe(5)
    expect(chunks[0]!.type).toBe('block-start')
    expect(chunks[0]!.blockType).toBe('text')
    expect(chunks[1]!.type).toBe('text-delta')
    expect(chunks[1]!.text).toBe('Quota check passed.')
    expect(chunks[2]!.type).toBe('block-end')
    expect(chunks[2]!.block?.text).toBe('Quota check passed.')
    // No upstream model was called: the reported usage is the REAL
    // consumption of the turn, which is zero. The simulated saving is
    // reported through the telemetry event, not through the usage chunk.
    expect(chunks[3]!.type).toBe('usage')
    expect(chunks[3]!.usage?.inputTokens).toBe(0)
    expect(chunks[3]!.usage?.outputTokens).toBe(0)
    expect(chunks[3]!.usage?.totalTokens).toBe(0)
    expect(chunks[4]!.type).toBe('finish')
    // `finish.reason` is a FinishReason OBJECT in the DSH contract.
    expect(chunks[4]!.reason).toEqual({ kind: 'stop' })
  })
})
