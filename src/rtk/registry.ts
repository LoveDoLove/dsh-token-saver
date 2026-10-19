/**
 * RTK filter registry: name lookup and aliases.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import type { RtkFilterFn } from './applyFilter'
import { gitDiff } from './filters/gitDiff'
import { gitStatus } from './filters/gitStatus'
import { gitLog } from './filters/gitLog'
import { grep } from './filters/grep'
import { find } from './filters/find'
import { ls } from './filters/ls'
import { tree } from './filters/tree'
import { dedupLog } from './filters/dedupLog'
import { smartTruncate } from './filters/smartTruncate'
import { readNumbered } from './filters/readNumbered'
import { searchList } from './filters/searchList'
import { buildOutput } from './filters/buildOutput'

export const REGISTRY = new Map<string, RtkFilterFn>([
  ['git-diff', gitDiff],
  ['git-status', gitStatus],
  ['git-log', gitLog],
  ['grep', grep],
  ['find', find],
  ['ls', ls],
  ['tree', tree],
  ['dedup-log', dedupLog],
  ['smart-truncate', smartTruncate],
  ['read-numbered', readNumbered],
  ['search-list', searchList],
  ['build-output', buildOutput],
])

export const ALIASES = new Map<string, string>([
  ['rg', 'grep'],
  ['ripgrep', 'grep'],
  ['fd', 'find'],
])

export function resolveFilter(name: string): RtkFilterFn | null {
  const normalized = name.toLowerCase().trim()
  const target = ALIASES.get(normalized) ?? normalized
  return REGISTRY.get(target) ?? null
}

export function allFilters(): ReadonlyMap<string, RtkFilterFn> {
  return REGISTRY
}
