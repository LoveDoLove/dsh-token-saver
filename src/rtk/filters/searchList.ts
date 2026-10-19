/**
 * Compact file search list (e.g. glob / file find) output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { SEARCH_LIST_PER_DIR_MAX, SEARCH_LIST_TOTAL_DIR_MAX } from '../constants'
import type { RtkFilterFn } from '../applyFilter'

export const searchList: RtkFilterFn = function searchList(
  text: string,
  perDirMax = SEARCH_LIST_PER_DIR_MAX,
  totalDirMax = SEARCH_LIST_TOTAL_DIR_MAX,
): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return text

  const dirs = new Map<string, string[]>()
  for (const line of lines) {
    const trimmed = line.trim()
    const lastSlash = trimmed.lastIndexOf('/')
    const dir = lastSlash === -1 ? '.' : trimmed.slice(0, lastSlash)
    const file = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1)
    let arr = dirs.get(dir)
    if (!arr) {
      arr = []
      dirs.set(dir, arr)
    }
    arr.push(file)
  }

  const out: string[] = []
  let dirCount = 0
  let totalOmitted = 0

  for (const [dir, files] of dirs) {
    if (dirCount >= totalDirMax) {
      totalOmitted += files.length
      continue
    }
    dirCount++

    const shown = files.slice(0, perDirMax)
    const omitted = files.length - shown.length
    totalOmitted += omitted

    out.push(`${dir}/: ${shown.join(', ')}${omitted > 0 ? ` (+${omitted} more)` : ''}`)
  }

  if (totalOmitted > 0) {
    out.push(`\n[total: ${lines.length} files across ${dirs.size} dirs, ${totalOmitted} omitted]`)
  }

  return out.join('\n')
}

searchList.filterName = 'search-list'
