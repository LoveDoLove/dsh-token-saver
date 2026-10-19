/**
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Wire message compression engine for DSH outbound LLM requests.
 */

import { formatBytes } from '../token-saver/format.js'
import { compressText as rtkCompressText, type RtkStats } from './index.js'

export type { RtkStats }

export interface CompressOptions {
  enabled?: boolean
  wire?: string
}

export interface CompressRequestResult {
  payload: unknown
  stats: RtkStats
}

function createRtkStats(): RtkStats {
  return {
    bytesBefore: 0,
    bytesAfter: 0,
    saved: 0,
    hits: [],
  }
}

function compressText(
  text: string,
  stats: RtkStats,
): { compressed: boolean; text: string } {
  if (typeof text !== 'string' || text.length === 0) {
    return { compressed: false, text }
  }

  const res = rtkCompressText(text, stats)
  return { compressed: res.compressed, text: res.text }
}

/**
 * Walk wire messages across diverse LLM protocol formats and compress tool outputs in-place.
 * Preserves error blocks, user messages, and non-tool payload components verbatim.
 */
export function compressMessages(
  body: unknown,
  options?: CompressOptions | boolean | string,
  _legacyInPlace?: boolean,
): RtkStats | null {
  const enabled =
    typeof options === 'boolean'
      ? options
      : typeof options === 'string'
        ? true
        : options?.enabled ?? true

  if (body == null || typeof body !== 'object' || enabled === false) {
    return null
  }

  const stats = createRtkStats()
  const obj = body as Record<string, unknown>

  // 1. Anthropic Messages / OpenAI Chat / DSH RequestMessage format: `body.messages` or direct array
  const messages = Array.isArray(body)
    ? (body as unknown[])
    : Array.isArray(obj.messages)
      ? (obj.messages as unknown[])
      : null

  if (messages) {
    for (const msg of messages) {
      if (msg == null || typeof msg !== 'object') continue
      const message = msg as Record<string, unknown>

      // (a) OpenAI-style tool output: role === 'tool'
      if (message.role === 'tool') {
        if (typeof message.content === 'string') {
          const res = compressText(message.content, stats)
          if (res.compressed) message.content = res.text
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part != null && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
              const textPart = part as { type: string; text?: string }
              if (typeof textPart.text === 'string') {
                const res = compressText(textPart.text, stats)
                if (res.compressed) textPart.text = res.text
              }
            }
          }
        }
      }

      // (b) Anthropic-style tool output: role === 'user' with content: [{ type: 'tool_result' }]
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block == null || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          if (b.type === 'tool_result') {
            // Never compress tool errors
            if (b.is_error === true || b.status === 'error') continue

            if (typeof b.content === 'string') {
              const res = compressText(b.content, stats)
              if (res.compressed) b.content = res.text
            } else if (Array.isArray(b.content)) {
              for (const part of b.content) {
                if (part != null && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
                  const textPart = part as { type: string; text?: string }
                  if (typeof textPart.text === 'string') {
                    const res = compressText(textPart.text, stats)
                    if (res.compressed) textPart.text = res.text
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 2. OpenAI Responses API: `body.input`
  if (Array.isArray(obj.input)) {
    for (const item of obj.input) {
      if (item == null || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      if (entry.type === 'function_call_output') {
        if (entry.status === 'error') continue
        if (typeof entry.output === 'string') {
          const res = compressText(entry.output, stats)
          if (res.compressed) entry.output = res.text
        }
      } else if (entry.role === 'tool' && typeof entry.content === 'string') {
        const res = compressText(entry.content, stats)
        if (res.compressed) entry.content = res.text
      } else if (Array.isArray(entry.content)) {
        for (const part of entry.content) {
          if (part != null && typeof part === 'object') {
            const p = part as Record<string, unknown>
            if (p.type === 'tool_result' && (p.is_error === true || p.status === 'error')) continue
            if (p.type === 'text' && typeof p.text === 'string') {
              const res = compressText(p.text, stats)
              if (res.compressed) p.text = res.text
            }
          }
        }
      }
    }
  }

  // 3. Kiro / AWS Bedrock style conversationState
  if (obj.conversationState != null && typeof obj.conversationState === 'object') {
    const cs = obj.conversationState as Record<string, unknown>
    const current = cs.currentMessage as Record<string, unknown> | undefined
    const toolResults = (current?.userInputMessageContext as Record<string, unknown> | undefined)?.toolResults
    if (Array.isArray(toolResults)) {
      for (const tr of toolResults) {
        if (tr == null || typeof tr !== 'object') continue
        const item = tr as Record<string, unknown>
        if (item.status === 'error') continue
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block != null && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string') {
              const textObj = block as { text: string }
              const res = compressText(textObj.text, stats)
              if (res.compressed) textObj.text = res.text
            }
          }
        }
      }
    }
  }

  return stats
}

/**
 * Universal wrapper for compressing any request payload across all DSH request wires.
 */
export function compressRequest(
  payload: unknown,
  wire?: string,
  enabled: boolean = true,
): CompressRequestResult {
  const stats = compressMessages(payload, { enabled, wire }) ?? createRtkStats()
  return {
    payload,
    stats,
  }
}

/**
 * Generate human-readable summary of RTK savings.
 */
export function describeSavings(stats: RtkStats | null | undefined): string | null {
  if (!stats || stats.hits.length === 0 || stats.saved <= 0) return null
  const percent = stats.bytesBefore > 0 ? Math.round((stats.saved / stats.bytesBefore) * 100) : 0
  const uniqueFilters = Array.from(new Set(stats.hits.map((h) => h.filter)))
  return `rtk: saved ${formatBytes(stats.saved)} across ${stats.hits.length} hit(s) (${percent}% reduction) [${uniqueFilters.join(', ')}]`
}
