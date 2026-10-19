/**
 * Shell command utilities for local responses.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

export const TWO_WORD_COMMANDS = new Set([
  'git',
  'npm',
  'docker',
  'kubectl',
  'cargo',
  'go',
  'pip',
  'yarn',
])

export const LISTING_COMMANDS = new Set([
  'ls',
  'dir',
  'find',
  'tree',
  'pwd',
  'cd',
  'mkdir',
  'rmdir',
  'rm',
])

export const READING_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'bat',
  'type',
])

const GREP_FLAGS_WITH_ARGS = new Set([
  '-C',
  '-B',
  '-A',
  '-m',
  '--context',
  '--before-context',
  '--after-context',
  '--max-count',
])

const ESCAPABLE = new Set([' ', '\t', '\n', '\r', '\f', '\v', "'", '"'])
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const EMPTY_FILEPATHS = '<filepaths>\n</filepaths>'

export function shellWords(command: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quote = ''
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") quote = ''
      else word = (word ?? '') + char
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = ''
        continue
      }
      if (char === '\\') {
        const next = command[index + 1]
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          word = (word ?? '') + next
          index += 1
        } else {
          word = (word ?? '') + '\\'
        }
        continue
      }
      word = (word ?? '') + char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      if (word === null) word = ''
      continue
    }
    if (char === '\\' && ESCAPABLE.has(command[index + 1] ?? '')) {
      if (word === null) word = ''
      word += command[index + 1]
      index += 1
      continue
    }
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === '\f' ||
      char === '\v'
    ) {
      if (word !== null) {
        words.push(word)
        word = null
      }
      continue
    }
    if (word === null) word = ''
    word += char
  }
  if (quote !== '') throw new Error('no closing quotation')
  if (word !== null) words.push(word)
  return words
}

export function isEnvAssignment(part: string): boolean {
  return ENV_ASSIGNMENT.test(part)
}

export function stripEnvAssignments(parts: readonly string[]): string[] {
  let index = 0
  while (index < parts.length && isEnvAssignment(parts[index]!)) {
    index += 1
  }
  return parts.slice(index)
}

export function extractCommandPrefix(command: string): string {
  if (command.includes('`') || command.includes('$(')) {
    return 'command_injection_detected'
  }

  let parts: string[]
  try {
    parts = shellWords(command)
  } catch {
    const rawTokens = command.trim().split(/\s+/).filter(Boolean)
    const stripped = stripEnvAssignments(rawTokens)
    return stripped[0] ?? 'none'
  }

  if (parts.length === 0) return 'none'

  const envParts: string[] = []
  let index = 0
  while (index < parts.length && isEnvAssignment(parts[index]!)) {
    envParts.push(parts[index]!)
    index += 1
  }

  if (index >= parts.length) return 'none'

  const first = parts[index]!
  const second = parts[index + 1]

  if (TWO_WORD_COMMANDS.has(first) && second !== undefined && !second.startsWith('-')) {
    return `${first} ${second}`
  }

  if (envParts.length > 0) {
    return [...envParts, first].join(' ')
  }
  return first
}

function filepathBlock(paths: readonly string[]): string {
  const clean = paths.map((p) => p.trim()).filter((p) => p.length > 0)
  if (clean.length === 0) return EMPTY_FILEPATHS
  return `<filepaths>\n${clean.join('\n')}\n</filepaths>`
}

export function truncateOutput(output: string): string {
  let text = output
  for (const marker of ['<', '\n\n']) {
    if (text.includes(marker)) {
      text = text.split(marker)[0]!.trim()
    }
  }
  return text
}

export function extractFilepathsFromCommand(command: string, _output?: string): string {
  let parts: string[]
  try {
    parts = shellWords(command)
  } catch {
    return EMPTY_FILEPATHS
  }

  const clean = stripEnvAssignments(parts)
  if (clean.length === 0) return EMPTY_FILEPATHS

  const first = clean[0]!
  const base = (first.split(/[\\/]/).pop() ?? first).toLowerCase()

  if (LISTING_COMMANDS.has(base)) return EMPTY_FILEPATHS

  if (READING_COMMANDS.has(base)) {
    const paths = clean.slice(1).filter((p) => !p.startsWith('-'))
    return filepathBlock(paths)
  }

  if (base !== 'grep') return EMPTY_FILEPATHS

  const positional: string[] = []
  let patternViaFlag = false
  let skipNext = false

  for (let i = 1; i < clean.length; i += 1) {
    if (skipNext) {
      skipNext = false
      continue
    }
    const token = clean[i]!
    if (token === '-e' || token === '-f' || token === '--regexp') {
      patternViaFlag = true
      skipNext = true
      continue
    }
    if (token.startsWith('--regexp=')) {
      patternViaFlag = true
      continue
    }
    if (GREP_FLAGS_WITH_ARGS.has(token)) {
      skipNext = true
      continue
    }
    if (token.startsWith('-')) continue
    positional.push(token)
  }

  const paths = patternViaFlag ? positional : positional.slice(1)
  return filepathBlock(paths)
}
