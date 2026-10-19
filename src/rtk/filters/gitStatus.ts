/**
 * Compact git status output.
 * Ported from dsh-our-free-model / open-sse/rtk git::format_status_output under MIT license.
 */

import { STATUS_MAX_FILES, STATUS_MAX_UNTRACKED } from '../constants.js'
import type { RtkFilterFn } from '../applyFilter.js'

export const gitStatus: RtkFilterFn = function gitStatus(status: string): string {
  const lines = status.split('\n')
  const staged: string[] = []
  const modified: string[] = []
  const untracked: string[] = []
  const conflicts: string[] = []
  let branch = ''

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) continue

    if (line.startsWith('## ')) {
      branch = line.slice(3).split('...')[0]?.trim() ?? ''
      continue
    }

    if (line.startsWith('On branch ')) {
      branch = line.replace('On branch ', '').trim()
      continue
    }

    // Porcelain format: 2 status characters + space + path
    if (line.length >= 3 && line[2] === ' ') {
      const x = line[0]!
      const y = line[1]!
      const file = line.slice(3).trim()

      if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
        conflicts.push(file)
      } else {
        if (x !== ' ' && x !== '?') staged.push(`${x} ${file}`)
        if (y !== ' ' && y !== '?') modified.push(`${y} ${file}`)
        if (x === '?' && y === '?') untracked.push(file)
      }
      continue
    }

    // Long format fallback
    const trimmed = line.trim()
    if (trimmed.startsWith('modified:')) {
      modified.push(trimmed.replace('modified:', '').trim())
    } else if (trimmed.startsWith('new file:')) {
      staged.push(`A ${trimmed.replace('new file:', '').trim()}`)
    } else if (trimmed.startsWith('deleted:')) {
      staged.push(`D ${trimmed.replace('deleted:', '').trim()}`)
    }
  }

  const parts: string[] = []
  if (branch) parts.push(`branch: ${branch}`)

  if (conflicts.length > 0) {
    parts.push(`conflicts (${conflicts.length}):\n${conflicts.map((f) => `  ${f}`).join('\n')}`)
  }

  if (staged.length > 0) {
    const shown = staged.slice(0, STATUS_MAX_FILES)
    const extra = staged.length - shown.length
    let s = `staged (${staged.length}):\n${shown.map((f) => `  ${f}`).join('\n')}`
    if (extra > 0) s += `\n  ... and ${extra} more`
    parts.push(s)
  }

  if (modified.length > 0) {
    const shown = modified.slice(0, STATUS_MAX_FILES)
    const extra = modified.length - shown.length
    let s = `modified (${modified.length}):\n${shown.map((f) => `  ${f}`).join('\n')}`
    if (extra > 0) s += `\n  ... and ${extra} more`
    parts.push(s)
  }

  if (untracked.length > 0) {
    const shown = untracked.slice(0, STATUS_MAX_UNTRACKED)
    const extra = untracked.length - shown.length
    let s = `untracked (${untracked.length}):\n${shown.map((f) => `  ${f}`).join('\n')}`
    if (extra > 0) s += `\n  ... and ${extra} more`
    parts.push(s)
  }

  if (parts.length === 0) {
    // An empty status is a fact the model must be told explicitly: silence
    // reads as "the command failed" and the model runs status again.
    return 'Clean working tree'
  }
  if (branch && conflicts.length === 0 && staged.length === 0 && modified.length === 0 && untracked.length === 0) {
    return `branch: ${branch}\nClean working tree`
  }
  return parts.join('\n\n')
}

gitStatus.filterName = 'git-status'
