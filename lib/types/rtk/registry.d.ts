/**
 * RTK filter registry: name lookup and aliases.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import type { RtkFilterFn } from './applyFilter.js';
export declare const REGISTRY: Map<string, RtkFilterFn>;
export declare const ALIASES: Map<string, string>;
export declare function resolveFilter(name: string): RtkFilterFn | null;
export declare function allFilters(): ReadonlyMap<string, RtkFilterFn>;
