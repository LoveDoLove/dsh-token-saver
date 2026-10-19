/**
 * Compact git log output.
 * Ported from dsh-our-free-model / open-sse/rtk git::compact_log under MIT license.
 */

import { GIT_LOG_MAX_LINES } from '../constants'
import type { RtkFilterFn } from '../applyFilter'

export const gitLog: RtkFilterFn = function gitLog(log: string, maxLines = GIT_LOG_MAX_LINES): string {
  const lines = log.split('\n')
  const commits: string[] = []
  let currentHash = ''
  let currentAuthor = ''
  let currentDate = ''
  let currentSubject = ''
  let truncated = false

  function flushCommit() {
    if (currentHash) {
      const shortHash = currentHash.slice(0, 7)
      const parts = [shortHash]
      if (currentSubject) parts.push(currentSubject)
      if (currentAuthor) parts.push(`(${currentAuthor})`)
      if (currentDate) parts.push(`[${currentDate}]`)
      commits.push(parts.join(' '))
      currentHash = ''
      currentAuthor = ''
      currentDate = ''
      currentSubject = ''
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('commit ') && /^[a-f0-9]{7,40}$/i.test(line.slice(7).trim())) {
      flushCommit()
      if (commits.length >= maxLines) {
        truncated = true
        break
      }
      currentHash = line.slice(7).trim()
      continue
    }

    if (currentHash) {
      if (line.startsWith('Author:')) {
        currentAuthor = line.replace('Author:', '').split('<')[0]?.trim() ?? ''
      } else if (line.startsWith('Date:')) {
        currentDate = line.replace('Date:', '').trim()
      } else if (!currentSubject && !line.startsWith('Merge:')) {
        currentSubject = line
      }
    } else {
      // One-line format fallback: e.g. "a1b2c3d Subject text"
      if (/^[a-f0-9]{7,40}\s+/i.test(line)) {
        if (commits.length >= maxLines) {
          truncated = true
          break
        }
        commits.push(line)
      }
    }
  }

  flushCommit()

  if (commits.length === 0) return log
  let output = commits.join('\n')
  if (truncated) {
    output += `\n... (${lines.length - maxLines} lines truncated)`
  }
  return output
}

gitLog.filterName = 'git-log'
