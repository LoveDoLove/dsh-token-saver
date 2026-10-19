/**
 * Compact git diff output.
 * Ported from dsh-our-free-model / open-sse/rtk git::compact_diff under MIT license.
 */

import { GIT_DIFF_HUNK_MAX_LINES } from '../constants.js'
import type { RtkFilterFn } from '../applyFilter.js'

export const gitDiff: RtkFilterFn = function gitDiff(diff: string, maxLines = GIT_DIFF_HUNK_MAX_LINES): string {
  if (diff.includes('[full diff: rtk git diff --no-compact]')) {
    return diff
  }
  const files = diff.split(/^diff --git /m)
  const result: string[] = []
  let totalTruncated = false

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
      totalTruncated = true
    }

    const summaryParts: string[] = []
    if (added > 0) summaryParts.push(`+${added}`)
    if (removed > 0) summaryParts.push(`-${removed}`)
    const summary = summaryParts.length > 0 ? ` (${summaryParts.join(' ')})` : ''

    result.push(`${fileName}${summary}\n${fileHeader.join('\n')}`)
  }

  let output = result.join('\n\n')
  if (totalTruncated) {
    output += '\n\n[full diff: rtk git diff --no-compact]'
  }
  return output
}

gitDiff.filterName = 'git-diff'
