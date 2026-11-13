import { truncate } from './truncate.js'

export interface GrepFoldOptions {
  readonly pattern?: string
  readonly grepContextLines?: number
  readonly grepMaxMatches?: number
  readonly grepHeadBytes?: number
  readonly grepTailBytes?: number
  readonly foldNonMatching?: boolean
}

export interface GrepFoldResult {
  readonly content: string
  readonly folded: boolean
  readonly matchCount: number
  readonly truncatedMatches: number
  readonly originalBytes: number
  readonly trimmedBytes: number
}

const DEFAULTS = {
  pattern: '',
  grepContextLines: 2,
  grepMaxMatches: 30,
  grepHeadBytes: 8 * 1024,
  grepTailBytes: 4 * 1024,
  foldNonMatching: true,
} as const

export function foldGrepResult(input: string, options: GrepFoldOptions = {}): GrepFoldResult {
  const pattern = options.pattern ?? DEFAULTS.pattern
  const contextLines = Math.max(0, options.grepContextLines ?? DEFAULTS.grepContextLines)
  const maxMatches = Math.max(1, options.grepMaxMatches ?? DEFAULTS.grepMaxMatches)
  const headBytes = Math.max(0, options.grepHeadBytes ?? DEFAULTS.grepHeadBytes)
  const tailBytes = Math.max(0, options.grepTailBytes ?? DEFAULTS.grepTailBytes)
  const foldNonMatching = options.foldNonMatching ?? DEFAULTS.foldNonMatching

  const originalBytes = Buffer.byteLength(input, 'utf8')
  let matchCount = 0
  let truncatedMatches = 0

  if (!pattern || pattern.length === 0) {
    const t = truncate(input, { headBytes, tailBytes })
    return {
      content: t.content,
      folded: t.folded,
      matchCount: 0,
      truncatedMatches: 0,
      originalBytes,
      trimmedBytes: t.trimmedBytes,
    }
  }

  const lines = input.split('\n')
  const keepSet = new Set<number>()
  const matches = compileMatcher(pattern)
  let matched = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (matches(line)) {
      matched++
      if (matched > maxMatches) {
        truncatedMatches++
        continue
      }
      matchCount++
      const lo = Math.max(0, i - contextLines)
      const hi = Math.min(lines.length - 1, i + contextLines)
      for (let j = lo; j <= hi; j++) keepSet.add(j)
    }
  }

  if (matchCount === 0) {
    const t = truncate(input, { headBytes, tailBytes })
    return {
      content: t.content,
      folded: t.folded,
      matchCount,
      truncatedMatches,
      originalBytes,
      trimmedBytes: t.trimmedBytes,
    }
  }

  const keptLines = Array.from(keepSet).sort((a, b) => a - b)
  const keptRanges: string[] = []
  let cursor = 0
  let firstKept = true
  for (const idx of keptLines) {
    if (firstKept) {
      keptRanges.push(lines[idx] ?? '')
      firstKept = false
    } else if (idx === cursor + 1) {
      keptRanges.push(lines[idx] ?? '')
    } else {
      keptRanges.push(`... [${idx - cursor - 1} non-matching lines omitted, ${truncatedMatches} further matches truncated] ...`)
      keptRanges.push(lines[idx] ?? '')
    }
    cursor = idx
  }

  let content = keptRanges.join('\n')
  let folded = truncatedMatches > 0 || (foldNonMatching && Buffer.byteLength(content, 'utf8') < originalBytes)

  if (foldNonMatching && Buffer.byteLength(content, 'utf8') > headBytes + tailBytes) {
    const t = truncate(content, { headBytes, tailBytes })
    content = t.content
    folded = true
  }

  if (truncatedMatches > 0) {
    content = `${content}\n\n[${truncatedMatches} additional matches truncated beyond maxMatches=${maxMatches}; refine pattern or raise maxMatches to see them]`
  }

  return {
    content,
    folded,
    matchCount,
    truncatedMatches,
    originalBytes,
    trimmedBytes: Buffer.byteLength(content, 'utf8'),
  }
}

/**
 * Compile the pattern once, outside the per-line loop. Building a RegExp per
 * line is O(lines) compilations and lets a pathological model-supplied pattern
 * (`/(a+)+$/`) pin the event loop on every line of a large result.
 */
function compileMatcher(pattern: string): (line: string) => boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    const body = pattern.slice(1, -1)
    let re: RegExp
    try {
      re = new RegExp(body)
    } catch {
      return (line) => line.includes(body)
    }
    return (line) => re.test(line)
  }
  return (line) => line.includes(pattern)
}
