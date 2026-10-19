/**
 * Detectors for the five local response optimizations.
 * Ported and adapted from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Supports both DSH GenerateOptions and Anthropic wire request shapes.
 */

import type { LocalOptimizationKind } from '../types'
import {
  extractCommandPrefix,
  extractFilepathsFromCommand,
  truncateOutput,
} from './command'

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

export function quotaAnswer(request: RequestLike | undefined): LocalAnswer | null {
  const message = singleUserTurn(request)
  if (message === undefined) return null
  const text = textOf(message.content).trim().toLowerCase()
  const maxTokens = request?.maxTokens ?? request?.max_tokens
  const hasMax1 = maxTokens === 1 || maxTokens === '1'

  // Standard quota probe (max_tokens: 1 and text containing 'quota')
  if (hasMax1 && text.includes('quota')) {
    return {
      kind: 'quota',
      text: 'Quota check passed.',
      usage: makeUsage(10, 5),
      model: request?.model,
    }
  }

  // Integer probe (lone integer token probe)
  if (/^\d+$/.test(text)) {
    return {
      kind: 'quota',
      text: '1',
      usage: makeUsage(1, 1),
      model: request?.model,
    }
  }

  // Fallback quota check
  if (text.includes('quota') && (hasMax1 || (request as Record<string, unknown>)?.purpose === 'quota')) {
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

export function titleAnswer(request: RequestLike | undefined): LocalAnswer | null {
  if (hasTools(request)) return null

  // Native DSH purpose check
  if (request?.purpose === 'session-title') {
    return {
      kind: 'title',
      text: 'Conversation',
      usage: makeUsage(100, 5),
      model: request?.model,
    }
  }

  const system = systemText(request).toLowerCase()
  if (!system.includes('title')) return null
  const sentenceCase = system.includes('sentence-case title')
  const jsonField =
    system.includes('return json') &&
    system.includes('field') &&
    (system.includes('coding session') || system.includes('this session'))
  if (!sentenceCase && !jsonField) return null

  return {
    kind: 'title',
    text: 'Conversation',
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
  const userNamesFilepaths =
    lower.includes('filepaths') ||
    lower.includes('<filepaths>') ||
    lower.includes('file paths') ||
    lower.includes('filepath')
  const system = systemText(request).toLowerCase()
  const systemAsksForPaths =
    system.includes('extract any file paths') ||
    system.includes('file paths that this command') ||
    system.includes('filepaths') ||
    system.includes('file paths')
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


