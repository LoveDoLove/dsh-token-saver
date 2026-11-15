/**
 * Helper routines for parsing ripgrep/grep/code_search output lines.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

/**
 * A grep hit is `path:line:content`. The line must start at column 0 and the
 * path must contain no parenthesis — otherwise a JS/Python stack frame
 * (`    at foo (/app/src/a.js:10:5)`) parses as a hit and the filter rewrites
 * the trace into `foo (/app/src/a.js (1 hit):` plus a bogus line number.
 * Interior spaces stay legal: `rg` prints them for paths like `my dir/x.ts`.
 * `-` last in each class so it is read as a literal, not a range.
 */
const HIT_RE = /^([^\s(\n\r][^:\n\r()]*):(\d+):(.*)$/
const HYPHEN_RE = /^([^\s(\n\r][^\n\r()-]*)-(\d+)-(.*)$/

export function isGrepHit(line: string): boolean {
  return HIT_RE.test(line)
}

export function splitGrepHit(line: string): { file: string; lineNo: string; rest: string } | null {
  const m = line.match(HIT_RE)
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null
  return { file: m[1], lineNo: m[2], rest: m[3] }
}

export function parseGrepOutput(text: string): {
  groups: Map<string, Array<{ lineNo: string; text: string; isMatch: boolean }>>
  totalHits: number
} {
  const groups = new Map<string, Array<{ lineNo: string; text: string; isMatch: boolean }>>()
  let totalHits = 0

  for (const raw of text.split('\n')) {
    const m = raw.match(HIT_RE)
    if (m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      const file = m[1]
      const lineNo = m[2]
      const rest = m[3]
      let arr = groups.get(file)
      if (!arr) {
        arr = []
        groups.set(file, arr)
      }
      arr.push({ lineNo, text: rest, isMatch: true })
      totalHits++
      continue
    }

    const c = raw.match(HYPHEN_RE)
    if (c && c[1] !== undefined && c[2] !== undefined && c[3] !== undefined) {
      const file = c[1]
      const lineNo = c[2]
      const rest = c[3]
      let arr = groups.get(file)
      if (!arr) {
        arr = []
        groups.set(file, arr)
      }
      arr.push({ lineNo, text: rest, isMatch: false })
    }
  }

  return { groups, totalHits }
}
