export interface TruncateOptions {
  readonly headBytes?: number
  readonly tailBytes?: number
  readonly preserveStructure?: boolean
  readonly separator?: string
}

export interface TruncateResult {
  readonly content: string
  readonly folded: boolean
  readonly originalBytes: number
  readonly trimmedBytes: number
  readonly headBytesKept: number
  readonly tailBytesKept: number
  readonly omittedBytes: number
  readonly strategy: 'head-tail' | 'head-only' | 'tail-only' | 'unchanged'
}

const DEFAULTS = {
  headBytes: 16 * 1024,
  tailBytes: 8 * 1024,
  separator: '\n\n[... content trimmed to save tokens: N bytes omitted; full result available via `result.full` if your tool exposes it ...]\n\n',
} as const

export function truncate(input: string, options: TruncateOptions = {}): TruncateResult {
  const headBytes = Math.max(0, options.headBytes ?? DEFAULTS.headBytes)
  const tailBytes = Math.max(0, options.tailBytes ?? DEFAULTS.tailBytes)
  const separator = options.separator ?? DEFAULTS.separator
  const preserveStructure = options.preserveStructure ?? true

  const originalBytes = byteLength(input)
  if (headBytes + tailBytes === 0) {
    return {
      content: input,
      folded: false,
      originalBytes,
      trimmedBytes: originalBytes,
      headBytesKept: originalBytes,
      tailBytesKept: 0,
      omittedBytes: 0,
      strategy: 'unchanged',
    }
  }

  if (originalBytes <= headBytes + tailBytes + byteLength(separator)) {
    return {
      content: input,
      folded: false,
      originalBytes,
      trimmedBytes: originalBytes,
      headBytesKept: originalBytes,
      tailBytesKept: 0,
      omittedBytes: 0,
      strategy: 'unchanged',
    }
  }

  const headPart = preserveStructure ? breakAtLineBoundary(input, 0, headBytes, 'backward') : sliceByBytes(input, 0, headBytes)
  const tailPart = preserveStructure ? breakAtLineBoundary(input, originalBytes - tailBytes, originalBytes, 'forward') : sliceByBytes(input, originalBytes - tailBytes, originalBytes)
  const headContent = headPart.text
  const tailContent = tailPart.text
  const headBytesKept = headPart.bytes
  const tailBytesKept = tailPart.bytes
  const omittedBytes = Math.max(0, originalBytes - headBytesKept - tailBytesKept)

  const content = headContent + separator.replace('N bytes omitted', `${formatBytes(omittedBytes)} omitted`) + tailContent

  return {
    content,
    folded: true,
    originalBytes,
    trimmedBytes: byteLength(content),
    headBytesKept,
    tailBytesKept,
    omittedBytes,
    strategy: 'head-tail',
  }
}

export function truncateHead(input: string, maxBytes: number, options: TruncateOptions = {}): TruncateResult {
  const preserveStructure = options.preserveStructure ?? true
  const originalBytes = byteLength(input)
  if (maxBytes <= 0 || originalBytes <= maxBytes) {
    return {
      content: input,
      folded: false,
      originalBytes,
      trimmedBytes: originalBytes,
      headBytesKept: originalBytes,
      tailBytesKept: 0,
      omittedBytes: 0,
      strategy: 'unchanged',
    }
  }
  const headPart = preserveStructure ? breakAtLineBoundary(input, 0, maxBytes, 'backward') : sliceByBytes(input, 0, maxBytes)
  const sep = `\n[... truncated: first ${formatBytes(headPart.bytes)} of ${formatBytes(originalBytes)} kept ...]\n`
  return {
    content: headPart.text + sep,
    folded: true,
    originalBytes,
    trimmedBytes: byteLength(headPart.text) + byteLength(sep),
    headBytesKept: headPart.bytes,
    tailBytesKept: 0,
    omittedBytes: originalBytes - headPart.bytes,
    strategy: 'head-only',
  }
}

export function truncateTail(input: string, maxBytes: number, options: TruncateOptions = {}): TruncateResult {
  const preserveStructure = options.preserveStructure ?? true
  const originalBytes = byteLength(input)
  if (maxBytes <= 0 || originalBytes <= maxBytes) {
    return {
      content: input,
      folded: false,
      originalBytes,
      trimmedBytes: originalBytes,
      headBytesKept: 0,
      tailBytesKept: originalBytes,
      omittedBytes: 0,
      strategy: 'unchanged',
    }
  }
  const tailPart = preserveStructure ? breakAtLineBoundary(input, originalBytes - maxBytes, originalBytes, 'forward') : sliceByBytes(input, originalBytes - maxBytes, originalBytes)
  const sep = `\n[... truncated: last ${formatBytes(tailPart.bytes)} of ${formatBytes(originalBytes)} kept ...]\n`
  return {
    content: sep + tailPart.text,
    folded: true,
    originalBytes,
    trimmedBytes: byteLength(tailPart.text) + byteLength(sep),
    headBytesKept: 0,
    tailBytesKept: tailPart.bytes,
    omittedBytes: originalBytes - tailPart.bytes,
    strategy: 'tail-only',
  }
}

function byteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8')
}

function sliceByBytes(input: string, byteStart: number, byteEnd: number): { text: string; bytes: number } {
  const buf = Buffer.from(input, 'utf8')
  const text = buf.subarray(byteStart, byteEnd).toString('utf8')
  return { text, bytes: byteLength(text) }
}

function breakAtLineBoundary(
  input: string,
  byteStart: number,
  byteEnd: number,
  direction: 'forward' | 'backward',
): { text: string; bytes: number } {
  const buf = Buffer.from(input, 'utf8')
  const slice = buf.subarray(byteStart, byteEnd).toString('utf8')
  const sliceSize = byteLength(slice)
  if (!slice.includes('\n')) return { text: slice, bytes: sliceSize }
  const lines = slice.split('\n')
  if (direction === 'backward') {
    while (lines.length > 1) {
      lines.pop()
      const candidate = lines.join('\n')
      if (byteLength(candidate) <= byteEnd - byteStart) {
        return { text: candidate, bytes: byteLength(candidate) }
      }
    }
    return { text: slice, bytes: sliceSize }
  } else {
    while (lines.length > 1) {
      lines.shift()
      const candidate = lines.join('\n')
      if (byteLength(candidate) <= byteEnd - byteStart) {
        return { text: candidate, bytes: byteLength(candidate) }
      }
    }
    return { text: slice, bytes: sliceSize }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

export const __testing = {
  byteLength,
  sliceByBytes,
  breakAtLineBoundary,
  formatBytes,
}
