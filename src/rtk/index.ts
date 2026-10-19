/**
 * RTK (Rust Token Killer) optimization engine for tool results.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Core invariant:
 * - Only tool output is compacted (never system, user, or assistant text).
 * - Error results are NEVER compacted (preserved verbatim).
 * - Replacement only occurs when replacement is non-empty AND strictly smaller.
 * - Any filter failure fails open (original text preserved).
 */

import { RAW_CAP, MIN_COMPRESS_SIZE } from './constants.js'
import { safeApply, type RtkFilterFn } from './applyFilter.js'
import { autoDetectFilter } from './autodetect.js'
import { resolveFilter } from './registry.js'

export interface RtkHit {
  readonly filter: string
  readonly originalBytes: number
  readonly compactedBytes: number
  readonly savedBytes: number
}

export interface RtkStats {
  bytesBefore: number
  bytesAfter: number
  saved: number
  hits: RtkHit[]
}

export function createRtkStats(): RtkStats {
  return {
    bytesBefore: 0,
    bytesAfter: 0,
    saved: 0,
    hits: [],
  }
}

/**
 * Merge `source` stats into `target` in place. Only actual compression hits
 * move the counters (uncompressed calls yield zero-bytes stats), so merging a
 * no-op request's stats changes nothing.
 */
export function mergeRtkStats(target: RtkStats, ...sources: (RtkStats | null | undefined)[]): RtkStats {
  for (const source of sources) {
    if (!source || source.hits.length === 0) continue
    target.bytesBefore += source.bytesBefore
    target.bytesAfter += source.bytesAfter
    target.saved += source.saved
    target.hits.push(...source.hits)
  }
  return target
}

export interface CompressTextResult {
  readonly text: string
  readonly filterUsed: string | null
  readonly savedBytes: number
  readonly compressed: boolean
}

export function compressText(
  text: string,
  stats?: RtkStats,
  explicitFilterName?: string,
): CompressTextResult {
  if (typeof text !== 'string') {
    return { text, filterUsed: null, savedBytes: 0, compressed: false }
  }

  const bytesIn = text.length
  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    return { text, filterUsed: null, savedBytes: 0, compressed: false }
  }

  let filterFn: RtkFilterFn | null = null
  if (explicitFilterName) {
    filterFn = resolveFilter(explicitFilterName)
  }
  if (!filterFn) {
    filterFn = autoDetectFilter(text)
  }

  if (!filterFn) {
    return { text, filterUsed: null, savedBytes: 0, compressed: false }
  }

  const out = safeApply(filterFn, text)
  const bytesOut = out.length

  // Strict reduction rule: must be non-empty and strictly smaller than input
  if (bytesOut <= 0 || bytesOut >= bytesIn) {
    return { text, filterUsed: null, savedBytes: 0, compressed: false }
  }

  const saved = bytesIn - bytesOut
  const filterName = filterFn.filterName ?? filterFn.name ?? 'rtk-filter'

  if (stats) {
    stats.bytesBefore += bytesIn
    stats.bytesAfter += bytesOut
    stats.saved += saved
    stats.hits.push({
      filter: filterName,
      originalBytes: bytesIn,
      compactedBytes: bytesOut,
      savedBytes: saved,
    })
  }

  return {
    text: out,
    filterUsed: filterName,
    savedBytes: saved,
    compressed: true,
  }
}

export function formatRtkLog(stats: RtkStats): string | null {
  if (stats.hits.length === 0 || stats.saved <= 0) return null
  const percent = stats.bytesBefore > 0 ? Math.round((stats.saved / stats.bytesBefore) * 100) : 0
  const filterNames = Array.from(new Set(stats.hits.map((h) => h.filter))).join(', ')
  return `[RTK] saved ${stats.saved} / ${stats.bytesBefore} bytes (${percent}%) via [${filterNames}] across ${stats.hits.length} hit(s)`
}

export * from './constants.js'
export * from './applyFilter.js'
export * from './hitLine.js'
export * from './autodetect.js'
export * from './registry.js'
export * from './filters/gitDiff.js'
export * from './filters/gitStatus.js'
export * from './filters/gitLog.js'
export * from './filters/grep.js'
export * from './filters/find.js'
export * from './filters/ls.js'
export * from './filters/tree.js'
export * from './filters/dedupLog.js'
export * from './filters/smartTruncate.js'
export * from './filters/readNumbered.js'
export * from './filters/searchList.js'
export * from './filters/buildOutput.js'
export * from './compress.js'

