/**
 * Compact ls / dir output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { LS_NOISE_DIRS } from '../constants'
import type { RtkFilterFn } from '../applyFilter'

export const ls: RtkFilterFn = function ls(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  let filteredNoise = 0

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Detect if this line represents only a noise directory
    const parts = trimmed.split(/\s+/)
    const name = parts[parts.length - 1] ?? ''
    const cleanName = name.replace(/\/$/, '')

    if (LS_NOISE_DIRS.has(cleanName)) {
      filteredNoise++
      continue
    }
    kept.push(trimmed)
  }

  if (kept.length === 0) return text
  let out = kept.join('\n')
  if (filteredNoise > 0) {
    out += `\n[omitted ${filteredNoise} noise directory entries (node_modules, .git, etc.)]`
  }
  return out
}

ls.filterName = 'ls'
