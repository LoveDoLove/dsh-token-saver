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

import { truncate } from '../lib/truncate.js'
import { foldGrepResult } from '../lib/fold-grep.js'
import { compressText, type RtkStats } from '../rtk/index.js'
import type {
  PostToolDecision,
  ResolvedConfig,
  TelemetryHook,
  ToolContentBlock,
  ToolExecutionLike,
  ToolResultLike,
} from '../internal.js'

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
  /** Which strategy produced the trim; absent when nothing was folded. */
  readonly strategy?: 'head-tail' | 'head-only' | 'tail-only' | 'rtk'
  /**
   * Set when `strategy` is 'rtk'. Without it a caller cannot distinguish a
   * legitimate structured-output compaction from an autodetect misfire.
   */
  readonly rtkFilter?: string
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

/** Reads `pattern` from a Grep call's arguments; undefined when unusable. */
function grepPattern(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const pattern = (args as { pattern?: unknown }).pattern
  return typeof pattern === 'string' && pattern.length > 0 ? pattern : undefined
}

export interface PostToolPayloadLike {
  readonly exec?: ToolExecutionLike
  readonly result?: ToolResultLike
}

export function decidePostTool(payload: PostToolPayloadLike, options: ToolResultTrimOptions): ToolResultTrimResult {
  const { config, telemetry, rtkStats } = options
  try {
    const toolName = payload.exec?.name ?? payload.exec?.tool?.name
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

    let newAggregate = aggregated.text
    let strategy: 'head-tail' | 'head-only' | 'tail-only' | 'rtk' = 'head-tail'
    let rtkFilter: string | undefined

    // 1) RTK pass: structured-output compaction when enabled.
    //    Runs on tool output of any size (compressText enforces its own
    //    MIN_COMPRESS_SIZE floor) and only accepts a strictly-smaller,
    //    non-empty result. Sub-threshold outputs still get the RTK pass.
    let rtkApplied = false
    if (config.rtkEnabled) {
      // Autodetection samples only the first DETECT_WINDOW bytes and can
      // misclassify prose as `git status` output, which the gitStatus filter
      // then crushes to two lines. For read-like tools the payload is an
      // arbitrary file or response body, so only an explicit filter may apply.
      const implicit = !(toolName && READ_LIKE_TOOLS.has(toolName))
      const rtkResult = compressText(
        aggregated.text,
        rtkStats,
        toolName ? TOOL_RTK_FILTERS[toolName] : undefined,
        implicit,
      )
      if (rtkResult.compressed) {
        newAggregate = rtkResult.text
        strategy = 'rtk'
        rtkFilter = rtkResult.filterUsed ?? undefined
        rtkApplied = true
      }
    }

    if (!rtkApplied && originalBytes <= threshold) {
      // Sub-threshold and RTK did not compress: preserve original content.
      return {
        decision: { kind: 'accept', content },
        folded: false,
        originalBytes,
        trimmedBytes: originalBytes,
      }
    }

    if (!rtkApplied) {
      if (toolName && GREP_LIKE_TOOLS.has(toolName)) {
        // DSH passes the parsed tool arguments as exec.arguments. Fold only
        // when a usable pattern is present; foldGrepResult falls back to
        // head/tail truncation when it is absent.
        const result = foldGrepResult(aggregated.text, {
          pattern: grepPattern(payload.exec?.arguments),
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
      const rebuiltContent = rebuildContent(content, aggregated.segments, newAggregate)
      decision = { kind: 'accept', content: rebuiltContent }
    } else {
      decision = { kind: 'accept', content }
    }

    return {
      decision,
      folded: originalBytes - trimmedBytes > 0,
      originalBytes,
      trimmedBytes,
      strategy,
      rtkFilter,
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

/**
 * Strip explicit `undefined`-valued keys before a block re-enters the harness.
 * DSH snapshots every tool result with a strict lossless-JSON walk
 * (dsh-util-values walkJsonValue) that rejects `undefined` as a property
 * value, otherwise throwing "tool result must be losslessly JSON-serializable".
 */
function losslessBlock(block: ToolContentBlock): ToolContentBlock {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    if (value !== undefined) clean[key] = value
  }
  return clean as unknown as ToolContentBlock
}

/**
 * Move `offset` back to the nearest UTF-8 character boundary in `buf`.
 *
 * `Buffer.subarray(...).toString('utf8')` silently substitutes U+FFFD when the
 * slice starts mid-character, so any byte-offset split must land on a boundary.
 */
function floorCharBoundary(buf: Buffer, offset: number): number {
  let i = Math.min(Math.max(0, offset), buf.length)
  while (i > 0 && i < buf.length && (buf[i]! & 0xc0) === 0x80) i--
  return i
}

/**
 * Split `text` into `shares.length` parts whose UTF-8 byte sizes are
 * proportional to `shares`, without duplicating or dropping any byte.
 *
 * The last part absorbs the rounding remainder, so the concatenation is always
 * exactly `text`.
 */
function splitTextByByteShares(text: string, shares: readonly number[]): string[] {
  const count = shares.length
  if (count === 0) return []
  if (count === 1) return [text]

  const totalShare = shares.reduce((sum, s) => sum + Math.max(0, s), 0)
  const buf = Buffer.from(text, 'utf8')
  if (totalShare <= 0 || buf.length === 0) {
    // Nothing to weight by: keep the payload in one place rather than
    // repeating it across every block.
    return shares.map((_, i) => (i === 0 ? text : ''))
  }

  const parts: string[] = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      parts.push(buf.subarray(offset).toString('utf8'))
      break
    }
    const want = offset + Math.floor((Math.max(0, shares[i]!) / totalShare) * buf.length)
    const end = Math.max(offset, floorCharBoundary(buf, want))
    parts.push(buf.subarray(offset, end).toString('utf8'))
    offset = end
  }
  return parts
}

function rebuildContent(
  content: readonly ToolContentBlock[],
  segments: readonly { start: number; end: number }[],
  newText: string,
): readonly ToolContentBlock[] {
  if (content.length === 1) {
    // Never assign `data: undefined`: the key alone makes the block fail the
    // lossless snapshot even though the payload is otherwise plain JSON.
    return [{ type: 'text', text: newText }]
  }

  // Decide how much of the compacted text each text block receives, weighted by
  // that block's share of the original aggregate. The old head/tail heuristic
  // sliced `newText` with UTF-16 code-unit indices while every size in scope is
  // a UTF-8 byte count; for CJK that overshoots by 3x and the head and tail
  // ranges overlapped, so a 1500-byte payload came back out as 3000 duplicated
  // bytes.
  const textIndexes: number[] = []
  const shares: number[] = []
  for (const [i, block] of content.entries()) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const segment = segments[i]
      shares.push(
        segment ? Math.max(0, segment.end - segment.start) : Buffer.byteLength(block.text, 'utf8'),
      )
      textIndexes.push(i)
    }
  }

  const parts = splitTextByByteShares(newText, shares)
  const textByIndex = new Map<number, string>()
  for (const [n, blockIndex] of textIndexes.entries()) {
    textByIndex.set(blockIndex, parts[n] ?? '')
  }

  const out: ToolContentBlock[] = []
  for (const [i, block] of content.entries()) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      out.push(losslessBlock(block))
      continue
    }
    out.push(losslessBlock({ ...block, text: textByIndex.get(i) ?? '' }))
  }
  return out
}

export const __testing = { aggregateText, rebuildContent, GREP_LIKE_TOOLS, READ_LIKE_TOOLS, TOOL_RTK_FILTERS }
