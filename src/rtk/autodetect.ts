/**
 * Automatic detector for identifying the appropriate RTK filter to apply.
 * Ported from dsh-our-free-model / open-sse/rtk autodetect under MIT license.
 */

import { DETECT_WINDOW } from './constants'
import type { RtkFilterFn } from './applyFilter'
import { gitDiff } from './filters/gitDiff'
import { gitStatus } from './filters/gitStatus'
import { gitLog } from './filters/gitLog'
import { grep } from './filters/grep'
import { find } from './filters/find'
import { tree } from './filters/tree'
import { dedupLog } from './filters/dedupLog'
import { smartTruncate } from './filters/smartTruncate'
import { readNumbered, isNumberedOutput } from './filters/readNumbered'
import { searchList } from './filters/searchList'
import { buildOutput } from './filters/buildOutput'

export function isMostlyPorcelain(sampleLines: readonly string[]): boolean {
  if (sampleLines.length < 3) return false
  let porcelainCount = 0
  for (const line of sampleLines) {
    if (line.length >= 3 && line[2] === ' ' && /^[MADRCU?! ]{2}$/.test(line.slice(0, 2))) {
      porcelainCount++
    }
  }
  return porcelainCount / sampleLines.length >= 0.5
}

export function autoDetectFilter(text: string): RtkFilterFn | null {
  const window = text.slice(0, DETECT_WINDOW)
  const lines = window.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null

  // Idempotency guard: prevent duplicate compaction on already-compacted outputs
  if (
    text.includes('[full diff: rtk') ||
    text.includes('to save tokens; head and tail preserved') ||
    text.includes('[repeated ')
  ) {
    return null
  }

  // 1. git log (most specific git headers)
  if (/^commit [a-f0-9]{7,40}/m.test(window)) {
    return gitLog
  }

  // 2. git diff
  if (/^diff --git /m.test(window)) {
    return gitDiff
  }

  // 3. git status (standard prose/header)
  if (/^## /m.test(window) || /^On branch /m.test(window)) {
    return gitStatus
  }

  // 4. build output (check before porcelain, since cargo "Compiling foo" could false-match)
  if (
    /error\[E\d+\]/i.test(window) ||
    /TS\d{4}:/i.test(window) ||
    /SyntaxError:/i.test(window) ||
    /npm ERR!/i.test(window) ||
    /\bCompiling\s+\S+\s+v\d+/i.test(window)
  ) {
    return buildOutput
  }

  // 5. porcelain git status
  if (isMostlyPorcelain(lines)) {
    return gitStatus
  }

  // 6. grep/ripgrep hit lines (file:line:content)
  let grepHits = 0
  for (const l of lines.slice(0, 20)) {
    if (/^[^:\n\r]+:\d+:/.test(l)) grepHits++
  }
  if (grepHits >= 2) {
    return grep
  }

  // 7. tree format
  if (/[├└]──/m.test(window) || /│\s+/m.test(window)) {
    return tree
  }

  // 8. find / search list (paths)
  let pathLike = 0
  for (const l of lines.slice(0, 20)) {
    if (l.startsWith('./') || (l.includes('/') && !l.includes(' ') && l.length < 200)) {
      pathLike++
    }
  }
  if (pathLike >= 3) {
    return lines.length > 50 ? find : searchList
  }

  // 9. numbered code reading
  if (isNumberedOutput(lines)) {
    return readNumbered
  }

  // 10. repetitive log output
  let repeats = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1]) repeats++
  }
  if (repeats >= 3) {
    return dedupLog
  }

  // 11. generic smart truncate fallback for large text blobs
  if (text.split('\n').length >= 50) {
    return smartTruncate
  }

  return null
}
