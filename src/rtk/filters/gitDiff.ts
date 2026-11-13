/**
 * Compact git diff output.
 * Ported from dsh-our-free-model / open-sse/rtk git::compact_diff under MIT license.
 */

import { GIT_DIFF_HUNK_MAX_LINES, RTK_DIFF_MARKER } from '../constants.js'
import type { RtkFilterFn } from '../applyFilter.js'

export const gitDiff: RtkFilterFn = function gitDiff(diff: string, maxLines = GIT_DIFF_HUNK_MAX_LINES): string {
  if (diff.includes(RTK_DIFF_MARKER)) {
    return diff
  }
  const files = diff.split(/^diff --git /m)
  const result: string[] = []

  for (const file of files) {
    if (!file.trim()) continue

    const lines = file.split('\n')
    const firstLine = lines[0] ?? ''
    const bPart = firstLine.split(' b/')[1]
    const fileName = bPart ? bPart.trim() : (firstLine.split(' ')[0] ?? 'unknown')

    const fileHeader: string[] = []
    let added = 0
    let removed = 0
    let truncatedLines = 0
    let inHunk = false
    let hunkLines = 0

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      if (line.startsWith('@@')) {
        inHunk = true
        hunkLines = 0
        fileHeader.push(line)
        continue
      }
      if (!inHunk) continue

      if (line.startsWith('+') && !line.startsWith('+++')) {
        added++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed++
      }

      if (hunkLines < maxLines) {
        fileHeader.push(line)
        hunkLines++
      } else {
        truncatedLines++
      }
    }

    if (truncatedLines > 0) {
      fileHeader.push(`  ... (${truncatedLines} lines truncated)`)
    }

    const summaryParts: string[] = []
    if (added > 0) summaryParts.push(`+${added}`)
    if (removed > 0) summaryParts.push(`-${removed}`)
    const summary = summaryParts.length > 0 ? ` (${summaryParts.join(' ')})` : ''

    result.push(`${fileName}${summary}\n${fileHeader.join('\n')}`)
  }

  let output = result.join('\n\n')
  // Always stamp, not only when hunks were dropped. The pass that truncated
  // nothing still reshaped the diff (git headers stripped, per-file summary
  // prepended), and that reshaped form is what the guard keys on. Stamping
  // only on truncation left lossless compactions unrecognisable, so the next
  // pass truncated them as if they were raw log text.
  if (output) {
    output += `\n\n${RTK_DIFF_MARKER}`
  }
  return output
}

gitDiff.filterName = 'git-diff'
