/**
 * Generic head+tail truncation for large text outputs.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { SMART_TRUNCATE_MIN_LINES, SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL } from '../constants.js'
import type { RtkFilterFn } from '../applyFilter.js'

export const smartTruncate: RtkFilterFn = function smartTruncate(
  text: string,
  minLines = SMART_TRUNCATE_MIN_LINES,
  headLines = SMART_TRUNCATE_HEAD,
  tailLines = SMART_TRUNCATE_TAIL,
): string {
  const lines = text.split('\n')
  if (lines.length < minLines) return text

  const head = lines.slice(0, headLines)
  const tail = lines.slice(lines.length - tailLines)
  const omitted = lines.length - headLines - tailLines

  if (omitted <= 0) return text

  return [
    ...head,
    `\n... [${omitted} lines omitted to save tokens; head and tail preserved] ...\n`,
    ...tail,
  ].join('\n')
}

smartTruncate.filterName = 'smart-truncate'
