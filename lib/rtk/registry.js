/**
 * RTK filter registry: name lookup and aliases.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import { gitDiff } from './filters/gitDiff.js';
import { gitStatus } from './filters/gitStatus.js';
import { gitLog } from './filters/gitLog.js';
import { grep } from './filters/grep.js';
import { find } from './filters/find.js';
import { ls } from './filters/ls.js';
import { tree } from './filters/tree.js';
import { dedupLog } from './filters/dedupLog.js';
import { smartTruncate } from './filters/smartTruncate.js';
import { readNumbered } from './filters/readNumbered.js';
import { searchList } from './filters/searchList.js';
import { buildOutput } from './filters/buildOutput.js';
export const REGISTRY = new Map([
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
]);
export const ALIASES = new Map([
    ['rg', 'grep'],
    ['ripgrep', 'grep'],
    ['fd', 'find'],
]);
export function resolveFilter(name) {
    const normalized = name.toLowerCase().trim();
    const target = ALIASES.get(normalized) ?? normalized;
    return REGISTRY.get(target) ?? null;
}
export function allFilters() {
    return REGISTRY;
}
