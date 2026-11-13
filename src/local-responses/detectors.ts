/**
 * Detectors for the five local response optimizations.
 * Ported and adapted from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Supports both DSH GenerateOptions and Anthropic wire request shapes.
 */

import type { LocalOptimizationKind } from '../types.js'
import {
  extractCommandPrefix,
  extractFilepathsFromCommand,
  truncateOutput,
} from './command.js'

export const OPTIMIZATIONS: readonly LocalOptimizationKind[] = [
  'quota',
  'prefix',
  'title',
  'suggestion',
  'filepath',
]

export const LOCAL_RESPONSE_KINDS = OPTIMIZATIONS

export interface LocalAnswerUsage {
  readonly input?: number
  readonly output?: number
  readonly input_tokens?: number
  readonly output_tokens?: number
}

export function makeUsage(input: number, output: number): LocalAnswerUsage {
  return {
    input,
    output,
    input_tokens: input,
    output_tokens: output,
  }
}

export interface LocalAnswer {
  readonly kind: LocalOptimizationKind
  readonly text: string
  readonly usage: LocalAnswerUsage
  readonly model?: string
}

export interface RequestMessageLike {
  readonly role?: string
  readonly content?: unknown
}

export interface RequestLike {
  readonly messages?: readonly RequestMessageLike[]
  readonly system?: unknown
  readonly tools?: readonly unknown[]
  readonly maxTokens?: number
  readonly max_tokens?: number | string
  readonly purpose?: string
  readonly model?: string
  readonly provider?: string
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object') {
          const rec = block as Record<string, unknown>
          if (typeof rec.text === 'string') return rec.text
          if (rec.type === 'text' && typeof rec.text === 'string') return rec.text
        }
        return ''
      })
      .filter((t) => t.length > 0)
      .join('\n')
  }
  return ''
}

export function systemText(request: RequestLike | undefined): string {
  if (!request) return ''
  const parts: string[] = []
  if (typeof request.system === 'string') {
    parts.push(request.system)
  } else if (Array.isArray(request.system)) {
    parts.push(textOf(request.system))
  }
  for (const message of request.messages ?? []) {
    if (message?.role === 'system') {
      parts.push(textOf(message.content))
    }
  }
  return parts.join('\n')
}

export function singleUserTurn(request: RequestLike | undefined): RequestMessageLike | undefined {
  if (!request?.messages || !Array.isArray(request.messages)) return undefined
  let foundUser: RequestMessageLike | undefined
  for (const message of request.messages) {
    if (message?.role === 'system') continue
    if (message?.role === 'user') {
      if (foundUser !== undefined) return undefined // more than one user turn
      foundUser = message
    } else {
      // Any assistant or tool response means this is not a lone user turn
      return undefined
    }
  }
  return foundUser
}

export function hasTools(request: RequestLike | undefined): boolean {
  return Array.isArray(request?.tools) && request.tools.length > 0
}

/**
 * Pull the first human-authored string out of an arbitrary nested payload
 * (the title provider ships a JSON array of message objects; other callers
 * ship a plain string). Returns undefined when nothing usable is present.
 */
function firstHumanText(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined
  if (typeof value === 'string') return value.trim().length > 0 ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const role = (item as Record<string, unknown>).role
        if (typeof role === 'string' && role !== 'user' && role !== 'human') continue
        const nested = (item as Record<string, unknown>).content ?? (item as Record<string, unknown>).text
        const found = firstHumanText(nested, depth + 1)
        if (found !== undefined) return found
        continue
      }
      const found = firstHumanText(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (typeof rec.text === 'string') return firstHumanText(rec.text, depth + 1)
    if (rec.content !== undefined) return firstHumanText(rec.content, depth + 1)
  }
  return undefined
}

const TITLE_MAX_CHARS = 60

/** Reduce arbitrary message text to one short, clean title line. */
function titleize(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (line === undefined) return undefined
  const cleaned = line
    .replace(/^[#>*\-\s]+/, '')
    .replace(/[*_`]/g, '')
    .trim()
  if (cleaned.length === 0) return undefined
  if (cleaned.length <= TITLE_MAX_CHARS) return cleaned
  const cut = cleaned.slice(0, TITLE_MAX_CHARS)
  const space = cut.lastIndexOf(' ')
  return (space > TITLE_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trim()
}

/**
 * Derive a title from the request's own content.
 *
 * The DSH title provider wraps its input as
 * `Generate the session title from this JSON array of human messages:\n[...]`
 * (dsh-session-title-first-prompt-llm). Returns undefined rather than a
 * placeholder when nothing usable is found: a constant title is worse than
 * letting the real request through.
 */
function deriveTitle(request: RequestLike | undefined): string | undefined {
  const raw = firstHumanText(request?.messages)
  if (raw === undefined) return undefined
  const marker = raw.indexOf('JSON array of human messages')
  if (marker !== -1) {
    const colon = raw.indexOf(':', marker)
    if (colon === -1) return undefined
    try {
      return titleize(String(firstHumanText(JSON.parse(raw.slice(colon + 1).trim())) ?? ''))
    } catch {
      // Unparseable envelope: do not guess from the instruction text itself.
      return undefined
    }
  }
  return titleize(raw)
}

export function titleAnswer(request: RequestLike | undefined): LocalAnswer | null {
  if (hasTools(request)) return null

  // Native DSH purpose check. The real title request carries
  // purpose: 'session-title' and no tools, so this branch always fires when
  // local responses are on — it must produce a real title, never a constant.
  const isTitleRequest =
    request?.purpose === 'session-title' || isHeuristicTitleRequest(request)
  if (!isTitleRequest) return null

  const text = deriveTitle(request)
  if (text === undefined) return null

  return {
    kind: 'title',
    text,
    usage: makeUsage(100, 5),
    model: request?.model,
  }
}

/** System-prompt shape check for title requests that carry no `purpose`. */
function isHeuristicTitleRequest(request: RequestLike | undefined): boolean {
  const system = systemText(request).toLowerCase()
  if (!system.includes('title')) return false
  const sentenceCase = system.includes('sentence-case title')
  const jsonField =
    system.includes('return json') &&
    system.includes('field') &&
    (system.includes('coding session') || system.includes('this session'))
  return sentenceCase || jsonField
}

export function quotaAnswer(request: RequestLike | undefined): LocalAnswer | null {
  const message = singleUserTurn(request)
  if (message === undefined) return null
  const text = textOf(message.content).trim().toLowerCase()
  const maxTokens = request?.maxTokens ?? request?.max_tokens
  const hasMax1 = maxTokens === 1 || maxTokens === '1'

  // Quota probe: a lone user turn that asks about quota, sent with a
  // one-token budget. Upstream dsh-our-free-model gates the same answer on
  // `max_tokens === 1` plus the word "quota"; DSH spells the budget
  // `maxTokens`, so both spellings are accepted.
  //
  // A bare integer message is NOT a quota probe. It is an ordinary user
  // message, and answering it locally would swallow a real request without
  // ever reaching the model.
  if (hasMax1 && text.includes('quota')) {
    return {
      kind: 'quota',
      text: 'Quota check passed.',
      usage: makeUsage(10, 5),
      model: request?.model,
    }
  }

  return null
}

export function prefixAnswer(request: RequestLike | undefined): LocalAnswer | null {
  const message = singleUserTurn(request)
  if (message === undefined) return null
  const content = textOf(message.content)
  if (!content.includes('<policy_spec>') || !content.includes('Command:')) return null
  const start = content.lastIndexOf('Command:') + 'Command:'.length
  return {
    kind: 'prefix',
    text: extractCommandPrefix(content.slice(start).trim()),
    usage: makeUsage(100, 5),
    model: request?.model,
  }
}

export function suggestionAnswer(request: RequestLike | undefined): LocalAnswer | null {
  for (const message of request?.messages ?? []) {
    if (message?.role !== 'user') continue
    if (textOf(message.content).includes('[SUGGESTION MODE:')) {
      return {
        kind: 'suggestion',
        text: '',
        usage: makeUsage(100, 1),
        model: request?.model,
      }
    }
  }
  return null
}

export function filepathAnswer(request: RequestLike | undefined): LocalAnswer | null {
  const message = singleUserTurn(request)
  if (message === undefined || hasTools(request)) return null
  const content = textOf(message.content)
  if (!content.includes('Command:') || !content.includes('Output:')) return null

  const lower = content.toLowerCase()
  // Upstream only accepts the two explicit phrasings. The looser
  // "file paths" / "filepath" substrings matched ordinary requests (any
  // message mentioning a file path) and answered them locally.
  const userNamesFilepaths = lower.includes('filepaths')
  const system = systemText(request).toLowerCase()
  const systemAsksForPaths =
    system.includes('extract any file paths') || system.includes('file paths that this command')
  if (!userNamesFilepaths && !systemAsksForPaths) return null

  const start = content.indexOf('Command:') + 'Command:'.length
  const marker = content.indexOf('Output:', start)
  if (marker === -1) return null

  const command = content.slice(start, marker).trim()
  const output = truncateOutput(content.slice(marker + 'Output:'.length).trim())
  return {
    kind: 'filepath',
    text: extractFilepathsFromCommand(command, output),
    usage: makeUsage(100, 10),
    model: request?.model,
  }
}

export const DETECTORS: Record<LocalOptimizationKind, (req: RequestLike | undefined) => LocalAnswer | null> = {
  quota: quotaAnswer,
  prefix: prefixAnswer,
  title: titleAnswer,
  suggestion: suggestionAnswer,
  filepath: filepathAnswer,
}

export function detectOptimization(
  request: RequestLike | undefined,
  enabledKinds: ReadonlySet<LocalOptimizationKind> = new Set(OPTIMIZATIONS),
): LocalAnswer | null {
  for (const kind of OPTIMIZATIONS) {
    if (!enabledKinds.has(kind)) continue
    const detector = DETECTORS[kind]
    const answer = detector(request)
    if (answer !== null) return answer
  }
  return null
}

/**
 * Try detecting any enabled local response optimization.
 */
export function tryLocalResponses(
  request: RequestLike | undefined,
  enabled?: Partial<Record<LocalOptimizationKind, boolean>>,
): LocalAnswer | null {
  const kinds = new Set<LocalOptimizationKind>()
  for (const k of OPTIMIZATIONS) {
    if (enabled === undefined || enabled[k] !== false) {
      kinds.add(k)
    }
  }
  return detectOptimization(request, kinds)
}

/**
 * Convenient alias for tryLocalResponses.
 */
export const detectLocalResponse = tryLocalResponses


