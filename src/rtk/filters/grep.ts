/**
 * Compact grep/ripgrep output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { GREP_PER_FILE_MAX } from '../constants.js'
import { parseGrepOutput } from '../hitLine.js'
import type { RtkFilterFn } from '../applyFilter.js'

export const grep: RtkFilterFn = function grep(text: string, perFileMax = GREP_PER_FILE_MAX): string {
  const { groups, totalHits } = parseGrepOutput(text)
  if (groups.size === 0) return text

  const out: string[] = []
  let omittedTotal = 0

  for (const [file, lines] of groups) {
    const hits = lines.filter((l) => l.isMatch)
    const shownHits = hits.slice(0, perFileMax)
    const omitted = hits.length - shownHits.length
    omittedTotal += omitted

    out.push(`${file} (${hits.length} hit${hits.length === 1 ? '' : 's'}):`)
    for (const h of shownHits) {
      out.push(`  ${h.lineNo}: ${h.text}`)
    }
    if (omitted > 0) {
      out.push(`  ... and ${omitted} more match${omitted === 1 ? '' : 'es'}`)
    }
  }

  if (omittedTotal > 0) {
    out.push(`\n[total: ${totalHits} matches across ${groups.size} files, ${omittedTotal} omitted]`)
  }

  return out.join('\n')
}

grep.filterName = 'grep'
