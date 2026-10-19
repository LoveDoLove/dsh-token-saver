/**
 * Tool result trimming strategy: head/tail truncation, grep folding, plus the
 * RTK filter engine for structured CLI output (git diff/status/log, grep,
 * find, ls, tree, build output, logs).
 *
 * Base head/tail truncation ported from refs/dsh-token-saver (MIT).
 * RTK filters ported from dsh-our-free-model / open-sse/rtk (MIT).
 *
 * Fail-open contract: any error inside trimming falls back to `accept`
 * with the original content preserved verbatim.
 */

import { truncate } from '../lib/truncate'
import { foldGrepResult } from '../lib/fold-grep'
import { compressText, type RtkStats } from '../rtk'
import type {
  PostToolDecision,
  ResolvedConfig,
  TelemetryHook,
  ToolContentBlock,
  ToolResultLike,
} from '../internal'

export interface ToolResultTrimOptions {
  readonly config: ResolvedConfig
  readonly telemetry?: TelemetryHook
  readonly rtkStats?: RtkStats
}

export interface ToolResultTrimResult {
  readonly decision: PostToolDecision
  readonly folded: boolean
  readonly originalBytes: number
  readonly trimmedBytes: number
}

const GREP_LIKE_TOOLS = new Set([
  'grep',
  'rg',
  'ripgrep',
  'search',
  'grep_search',
  'content_search',
  'code_search',
])

const READ_LIKE_TOOLS = new Set([
  'read',
  'cat',
  'file_read',
  'get_file',
  'view',
  'fetch',
  'http_get',
  'curl',
])

/**
 * Optional per-tool RTK filter overrides: when a tool is known to emit a
 * particular structured format, use that filter explicitly instead of
 * autodetection. Autodetection remains the default path.
 */
const TOOL_RTK_FILTERS: Readonly<Record<string, string>> = {
  git_diff: 'git-diff',
  git_status: 'git-status',
  git_log: 'git-log',
}

export function shouldHandle(toolName: string | undefined, cfg: ResolvedConfig): boolean {
  if (!toolName) return false
  if (cfg.mode === 'off') return false
  if (cfg.excludeToolNames.includes(toolName)) return false
  if (cfg.includeToolNames.length > 0 && !cfg.includeToolNames.includes(toolName)) return false
  return true
}

export interface PostToolPayloadLike {
  readonly exec?: { readonly id?: string; readonly tool?: { readonly name?: string } }
  readonly result?: ToolResultLike
}

export function decidePostTool(payload: PostToolPayloadLike, options: ToolResultTrimOptions): ToolResultTrimResult {
  const { config, telemetry, rtkStats } = options
  try {
    const toolName = payload.exec?.tool?.name
    if (!shouldHandle(toolName, config)) {
      return {
        decision: { kind: 'accept' },
        folded: false,
        originalBytes: 0,
        trimmedBytes: 0,
      }
    }

    // Error results are NEVER compacted (preserved verbatim for correctness).
    if (payload.result?.isError) {
      return {
        decision: { kind: 'accept' },
        folded: false,
        originalBytes: 0,
        trimmedBytes: 0,
      }
    }

    if (payload.result?.value !== undefined && (!payload.result.content || payload.result.content.length === 0)) {
      return {
        decision: { kind: 'accept', value: payload.result.value },
        folded: false,
        originalBytes: 0,
        trimmedBytes: 0,
      }
    }

    const content = payload.result?.content
    if (!content || content.length === 0) {
      return {
        decision: { kind: 'accept' },
        folded: false,
        originalBytes: 0,
        trimmedBytes: 0,
      }
    }

    const aggregated = aggregateText(content)
    const originalBytes = Buffer.byteLength(aggregated.text, 'utf8')
    const threshold = config.headBytes + config.tailBytes + 256

    if (originalBytes <= threshold) {
      return {
        decision: { kind: 'accept', content },
        folded: false,
        originalBytes,
        trimmedBytes: originalBytes,
      }
    }

    let newAggregate = aggregated.text
    let strategy: 'head-tail' | 'head-only' | 'tail-only' | 'rtk' = 'head-tail'
    let rtkFilter: string | undefined

    // 1) RTK pass: structured-output compaction when enabled.
    //    Runs only on tool output; skips when the aggregate is not large enough
    //    or when the filter cannot guarantee a strictly-smaller, non-empty result.
    let rtkApplied = false
    if (config.rtkEnabled) {
      const rtkResult = compressText(
        aggregated.text,
        rtkStats,
        toolName ? TOOL_RTK_FILTERS[toolName] : undefined,
      )
      if (rtkResult.compressed) {
        newAggregate = rtkResult.text
        strategy = 'rtk'
        rtkFilter = rtkResult.filterUsed ?? undefined
        rtkApplied = true
      }
    }

    if (!rtkApplied) {
      if (toolName && GREP_LIKE_TOOLS.has(toolName)) {
        const result = foldGrepResult(aggregated.text, {
          grepHeadBytes: config.grepHeadBytes,
          grepTailBytes: config.grepTailBytes,
          grepMaxMatches: config.grepMaxMatches,
          grepContextLines: config.grepContextLines,
        })
        newAggregate = result.content
      } else {
        const t = truncate(aggregated.text, {
          headBytes: config.headBytes,
          tailBytes: config.tailBytes,
          preserveStructure: config.preserveStructure,
        })
        newAggregate = t.content
      }
    }

    const trimmedBytes = Buffer.byteLength(newAggregate, 'utf8')

    if (telemetry?.onFold) {
      telemetry.onFold({
        toolName,
        originalBytes,
        trimmedBytes,
        savedBytes: originalBytes - trimmedBytes,
        strategy,
        rtkFilter,
      })
    }

    let decision: PostToolDecision
    if (trimmedBytes < originalBytes) {
      const rebuiltContent = rebuildContent(content, aggregated.segments, newAggregate, aggregated.text)
      decision = { kind: 'accept', content: rebuiltContent }
    } else {
      decision = { kind: 'accept', content }
    }

    return {
      decision,
      folded: originalBytes - trimmedBytes > 0,
      originalBytes,
      trimmedBytes,
    }
  } catch {
    // Fail open: preserve the original result untouched.
    return {
      decision: { kind: 'accept' },
      folded: false,
      originalBytes: 0,
      trimmedBytes: 0,
    }
  }
}

interface AggregateText {
  readonly text: string
  readonly segments: readonly { readonly start: number; readonly end: number }[]
}

function aggregateText(content: readonly ToolContentBlock[]): AggregateText {
  const segments: { start: number; end: number }[] = []
  let offset = 0
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      const bytes = Buffer.byteLength(block.text, 'utf8')
      segments.push({ start: offset, end: offset + bytes })
      offset += bytes
    } else {
      const placeholder = `[non-text block: ${block.type}]`
      parts.push(placeholder)
      const placeholderBytes = Buffer.byteLength(placeholder, 'utf8')
      segments.push({ start: offset, end: offset + placeholderBytes })
      offset += placeholderBytes
    }
  }
  return { text: parts.join('\n\n'), segments }
}

function rebuildContent(
  content: readonly ToolContentBlock[],
  segments: readonly { start: number; end: number }[],
  newText: string,
  originalText: string,
): readonly ToolContentBlock[] {
  if (content.length === 1) {
    return [{ type: 'text', text: newText, data: undefined }]
  }
  const out: ToolContentBlock[] = []
  let pos = 0
  const newTextBytes = Buffer.byteLength(newText, 'utf8')
  const originalBytes = Buffer.byteLength(originalText, 'utf8')
  const prefix = newText.startsWith(originalText.slice(0, Math.min(50, originalText.length / 2)))
    ? newText.slice(0, newText.indexOf('\n\n[... '))
    : newText.slice(0, Math.min(newTextBytes, originalBytes / 3))

  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      out.push(block)
      pos += Buffer.byteLength(`[non-text block: ${block.type}]`, 'utf8')
      continue
    }
    if (pos === 0) {
      out.push({ ...block, text: prefix.length > 0 ? prefix : newText })
    } else if (newTextBytes > 0) {
      const tail = newText.slice(-Math.max(0, originalBytes - pos))
      out.push({ ...block, text: tail.length > 0 ? tail : '' })
    } else {
      out.push({ ...block, text: '' })
    }
    pos += Buffer.byteLength(block.text, 'utf8')
  }
  return out
}

export const __testing = { aggregateText, rebuildContent, GREP_LIKE_TOOLS, READ_LIKE_TOOLS, TOOL_RTK_FILTERS }
