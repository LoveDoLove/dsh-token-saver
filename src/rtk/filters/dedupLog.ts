/**
 * Deduplicate consecutive identical log lines.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { DEDUP_LINE_MAX } from '../constants'
import type { RtkFilterFn } from '../applyFilter'

export const dedupLog: RtkFilterFn = function dedupLog(text: string, maxLines = DEDUP_LINE_MAX): string {
  const lines = text.split('\n')
  if (lines.length > maxLines) return text // don't freeze on huge log files

  const out: string[] = []
  let prevLine: string | null = null
  let repeatCount = 0

  function flushRepeat() {
    if (repeatCount > 1) {
      out.push(`  ... [repeated ${repeatCount - 1} more time${repeatCount - 1 === 1 ? '' : 's'}]`)
    }
    repeatCount = 0
  }

  for (const raw of lines) {
    if (prevLine !== null && raw === prevLine) {
      repeatCount++
    } else {
      flushRepeat()
      out.push(raw)
      prevLine = raw
      repeatCount = 1
    }
  }
  flushRepeat()

  return out.join('\n')
}

dedupLog.filterName = 'dedup-log'
