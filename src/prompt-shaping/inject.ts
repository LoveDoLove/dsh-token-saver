/**
 * Prompt Shaping injection and idempotency.
 * Supports DSH native system prompt assembly as well as llm/stream options fallback.
 * Checks for both dsh-token-saver and ofm-token-saver markers to avoid duplicate shaping.
 */

export const DSH_INJECT_MARKER = '<!-- dsh-token-saver:prompt-shaping -->'
export const DSH_MARKER_END = '<!-- /dsh-token-saver:prompt-shaping -->'

export const OFM_INJECT_MARKER = '<!-- ofm-token-saver -->'
export const OFM_MARKER_END = '<!-- /ofm-token-saver -->'

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
  readonly text: string
  readonly injected: boolean
  readonly reason: 'created' | 'appended' | 'already-injected' | 'empty-text'
}

export function injectIntoSystemPrompt(
  currentSystem: string | undefined,
  textToInject: string,
): InjectionResult {
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
  // Strip dsh marker block
  let out = text.replace(
    new RegExp(`\\n*${DSH_INJECT_MARKER}[\\s\\S]*?${DSH_MARKER_END}\\n*`, 'g'),
    '\n\n',
  )
  // Strip ofm marker block
  out = out.replace(
    new RegExp(`\\n*${OFM_INJECT_MARKER}[\\s\\S]*?${OFM_MARKER_END}\\n*`, 'g'),
    '\n\n',
  )
  return out.trim()
}
