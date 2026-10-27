/**
 * Compact table-like CLI output (docker ps, kubectl get pods, ps aux, etc.).
 * Keeps header + first N rows + last N rows, omits middle.
 */
import type { RtkFilterFn } from '../applyFilter.js'

const TABLE_ROW_MIN = 3 // minimum rows to consider compaction
const TABLE_KEEP_HEAD = 2 // keep first N data rows
const TABLE_KEEP_TAIL = 2 // keep last N data rows

export const table: RtkFilterFn = function table(text: string): string {
  const lines = text.trim().split('\n')
  if (lines.length < TABLE_ROW_MIN + 1) return text // header + min data rows

  const header = lines[0]
  const dataRows = lines.slice(1)
  
  if (dataRows.length <= TABLE_KEEP_HEAD + TABLE_KEEP_TAIL) return text

  const head = dataRows.slice(0, TABLE_KEEP_HEAD)
  const tail = dataRows.slice(-TABLE_KEEP_TAIL)
  const omitted = dataRows.length - head.length - tail.length

  const out = [
    header,
    ...head,
    `  ... ${omitted} row${omitted === 1 ? '' : 's'} omitted ...`,
    ...tail,
  ]

  return out.join('\n')
}

table.filterName = 'table'
