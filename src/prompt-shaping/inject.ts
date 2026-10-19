/**
 * Prompt Shaping injection and idempotency across all DSH request wires.
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Supports:
 * - OpenAI Chat wire (`messages` with role='system' | 'developer')
 * - Anthropic Messages wire (`system` field as string or block array)
 * - OpenAI Responses wire (`instructions` or `input` system message)
 * - DSH RequestMessage native options
 *
 * Checks for both dsh-token-saver and ofm-token-saver markers to avoid duplicate shaping.
 */

export const DSH_INJECT_MARKER = '<!-- dsh-token-saver:prompt-shaping -->'
export const DSH_MARKER_END = '<!-- /dsh-token-saver:prompt-shaping -->'

export const OFM_INJECT_MARKER = '<!-- ofm-token-saver -->'
export const OFM_MARKER_END = '<!-- /ofm-token-saver -->'

const SEP = '\n\n'

export function hasAnyPromptShaping(text: string | undefined): boolean {
  if (typeof text !== 'string') return false
  return (
    (text.includes(DSH_INJECT_MARKER) && text.includes(DSH_MARKER_END)) ||
    (text.includes(OFM_INJECT_MARKER) && text.includes(OFM_MARKER_END))
  )
}

export function wrapPromptSegment(text: string): string {
  return `${DSH_INJECT_MARKER}\n${text.trim()}\n${DSH_MARKER_END}`
}

export interface InjectionResult {
  readonly text?: string
  readonly payload?: unknown
  readonly injected: boolean
  readonly reason: 'created' | 'appended' | 'already-injected' | 'empty-text' | 'shape-not-recognised'
}

export function injectIntoSystemPrompt(
  currentSystem: string | undefined,
  textToInject: string,
): { text: string; injected: boolean; reason: 'created' | 'appended' | 'already-injected' | 'empty-text' } {
  const trimmedToInject = textToInject.trim()
  if (!trimmedToInject) {
    return { text: currentSystem ?? '', injected: false, reason: 'empty-text' }
  }

  const base = currentSystem ?? ''
  if (hasAnyPromptShaping(base) || base.includes(trimmedToInject)) {
    return { text: base, injected: false, reason: 'already-injected' }
  }

  const segment = wrapPromptSegment(trimmedToInject)
  if (!base.trim()) {
    return { text: segment, injected: true, reason: 'created' }
  }

  return { text: `${base.trimEnd()}\n\n${segment}`, injected: true, reason: 'appended' }
}

export function stripPromptShaping(text: string): string {
  if (typeof text !== 'string') return text
  let out = text.replace(
    new RegExp(`\\n*${DSH_INJECT_MARKER}[\\s\\S]*?${DSH_MARKER_END}\\n*`, 'g'),
    '\n\n',
  )
  out = out.replace(
    new RegExp(`\\n*${OFM_INJECT_MARKER}[\\s\\S]*?${OFM_MARKER_END}\\n*`, 'g'),
    '\n\n',
  )
  return out.trim()
}

// ── Multi-wire injection helpers ──────────────────────────────────────────────

function isSystemMessage(message: unknown): message is { role: string; content?: unknown } {
  return (
    message !== null &&
    typeof message === 'object' &&
    ((message as { role?: unknown }).role === 'system' ||
      (message as { role?: unknown }).role === 'developer')
  )
}

function hasRegion(text: unknown): boolean {
  if (typeof text !== 'string') return false
  return hasAnyPromptShaping(text)
}

function contentHasRegion(content: unknown): boolean {
  if (typeof content === 'string') return hasRegion(content)
  if (Array.isArray(content)) {
    return content.some((block) => {
      if (block !== null && typeof block === 'object') {
        const text = (block as { text?: unknown }).text
        return typeof text === 'string' && hasRegion(text)
      }
      return false
    })
  }
  return false
}

function contentHasSegment(content: unknown, segment: string): boolean {
  if (typeof content === 'string') return content.includes(segment)
  if (Array.isArray(content)) {
    return content.some((block) => {
      if (block !== null && typeof block === 'object') {
        const text = (block as { text?: unknown }).text
        return typeof text === 'string' && text.includes(segment)
      }
      return false
    })
  }
  return false
}

/**
 * Check if the payload already contains injected prompt shaping across supported wires.
 */
export function hasInjected(payload: unknown, wire?: string): boolean {
  try {
    if (payload === null || typeof payload !== 'object') return false
    const obj = payload as Record<string, unknown>

    if (wire === 'chat') {
      if (!Array.isArray(obj.messages)) return false
      return obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content))
    }

    if (wire === 'messages') {
      if (contentHasRegion(obj.system)) return true
      if (Array.isArray(obj.messages)) {
        return obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content))
      }
      return false
    }

    if (wire === 'responses') {
      if (hasRegion(obj.instructions)) return true
      if (Array.isArray(obj.input)) {
        return obj.input.some((item) => isSystemMessage(item) && contentHasRegion((item as Record<string, unknown>).content))
      }
      return false
    }

    // Auto-detection
    if (contentHasRegion(obj.system)) return true
    if (hasRegion(obj.instructions)) return true
    if (Array.isArray(obj.messages)) {
      if (obj.messages.some((m) => isSystemMessage(m) && contentHasRegion(m.content))) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Universal system prompt injector across wire formats.
 */
export function injectSystem(
  payload: unknown,
  wire: string | undefined,
  text: string,
): { payload: unknown; injected: boolean; reason: InjectionResult['reason'] } {
  if (payload === null || typeof payload !== 'object') {
    return { payload, injected: false, reason: 'shape-not-recognised' }
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return { payload, injected: false, reason: 'empty-text' }
  }

  const segment = wrapPromptSegment(trimmed)
  const obj = payload as Record<string, unknown>
  const effectiveWire = wire ?? (obj.system !== undefined ? 'messages' : obj.instructions !== undefined ? 'responses' : 'chat')

  // 1. Anthropic Messages style
  if (effectiveWire === 'messages') {
    if (contentHasRegion(obj.system) || contentHasSegment(obj.system, segment)) {
      return { payload, injected: false, reason: 'already-injected' }
    }
    if (typeof obj.system === 'string') {
      obj.system = obj.system === '' ? segment : `${obj.system}${SEP}${segment}`
      return { payload, injected: true, reason: 'appended' }
    }
    if (Array.isArray(obj.system)) {
      obj.system.push({ type: 'text', text: segment })
      return { payload, injected: true, reason: 'appended' }
    }
    if (obj.system === undefined) {
      obj.system = segment
      return { payload, injected: true, reason: 'created' }
    }
  }

  // 2. OpenAI Chat style
  if (effectiveWire === 'chat') {
    if (Array.isArray(obj.messages)) {
      if (obj.messages.some((m) => isSystemMessage(m) && (contentHasRegion(m.content) || contentHasSegment(m.content, segment)))) {
        return { payload, injected: false, reason: 'already-injected' }
      }
      const existing = (obj.messages as unknown[]).find(isSystemMessage) as { role: string; content?: unknown } | undefined
      if (existing) {
        if (typeof existing.content === 'string') {
          existing.content = existing.content === '' ? segment : `${existing.content}${SEP}${segment}`
        } else if (Array.isArray(existing.content)) {
          existing.content.push({ type: 'text', text: segment })
        } else {
          existing.content = segment
        }
        return { payload, injected: true, reason: 'appended' }
      } else {
        ;(obj.messages as unknown[]).unshift({ role: 'system', content: segment })
        return { payload, injected: true, reason: 'created' }
      }
    }
  }

  // 3. OpenAI Responses style
  if (effectiveWire === 'responses') {
    if (typeof obj.instructions === 'string') {
      if (hasRegion(obj.instructions) || obj.instructions.includes(segment)) {
        return { payload, injected: false, reason: 'already-injected' }
      }
      obj.instructions = obj.instructions === '' ? segment : `${obj.instructions}${SEP}${segment}`
      return { payload, injected: true, reason: 'appended' }
    }
  }

  // Fallback for generic DSH object
  if (typeof obj.system === 'string') {
    const res = injectIntoSystemPrompt(obj.system, trimmed)
    obj.system = res.text
    return { payload, injected: res.injected, reason: res.reason }
  }

  return { payload, injected: false, reason: 'shape-not-recognised' }
}

/**
 * Remove injected prompt segments from payload.
 */
export function stripInjected(
  payload: unknown,
  _wire?: string,
): { payload: unknown; stripped: boolean; reason: string } {
  if (payload === null || typeof payload !== 'object') {
    return { payload, stripped: false, reason: 'shape-not-recognised' }
  }
  const obj = payload as Record<string, unknown>
  let stripped = false

  if (typeof obj.system === 'string') {
    const cleaned = stripPromptShaping(obj.system)
    if (cleaned !== obj.system) {
      obj.system = cleaned
      stripped = true
    }
  }

  if (Array.isArray(obj.messages)) {
    for (const m of obj.messages) {
      if (isSystemMessage(m) && typeof m.content === 'string') {
        const cleaned = stripPromptShaping(m.content)
        if (cleaned !== m.content) {
          m.content = cleaned
          stripped = true
        }
      }
    }
  }

  return { payload, stripped, reason: stripped ? 'stripped' : 'none-found' }
}
