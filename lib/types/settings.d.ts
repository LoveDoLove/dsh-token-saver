import type { CavemanLevel, PonytailLevel } from './types.js';
import type { ResolvedConfig } from './internal.js';
import type { RtkStats } from './rtk/index.js';
export declare function resolveDshHome(): string;
export interface StoredSettings {
    enabled?: boolean;
    rtk?: boolean;
    prompts?: {
        caveman?: CavemanLevel;
        ponytail?: PonytailLevel;
    };
    local?: {
        enabled?: boolean;
        quota?: boolean;
        prefix?: boolean;
        title?: boolean;
        suggestion?: boolean;
        filepath?: boolean;
    };
}
export interface PublicSavings {
    bytesBefore: number;
    bytesAfter: number;
    saved: number;
    percent: number;
    blocks: number;
    calls: number;
    promptCalls: number;
    summary: string;
}
export interface PublicTokenSaver {
    enabled: boolean;
    rtk: boolean;
    prompts: {
        caveman: CavemanLevel;
        ponytail: PonytailLevel;
    };
    cavemanLevels: CavemanLevel[];
    ponytailLevels: PonytailLevel[];
    savings: PublicSavings;
}
export interface PublicLocalOptimize {
    enabled: boolean;
    quota: boolean;
    prefix: boolean;
    title: boolean;
    suggestion: boolean;
    filepath: boolean;
}
/**
 * Cumulative savings restored from disk, kept separately from the per-process
 * `RtkStats` accumulator so historical totals survive a host restart.
 */
export interface TotalSavings {
    bytesBefore: number;
    bytesAfter: number;
    saved: number;
    calls: number;
    blocks: number;
}
export interface RuntimeState {
    enabled: boolean;
    config: ResolvedConfig;
    rtkStats?: RtkStats;
    /** Live snapshot of the persisted totals; absent when telemetry is unbound. */
    totals?: () => TotalSavings;
}
export declare const CAVEMAN_LEVELS: CavemanLevel[];
export declare const PONYTAIL_LEVELS: PonytailLevel[];
export declare function getLiveSavings(rtkStats?: RtkStats, totals?: TotalSavings): PublicSavings;
export declare class SettingsManager {
    private readonly filePath;
    constructor(customPath?: string);
    load(): StoredSettings;
    save(settings: StoredSettings): void;
    init(initialConfig: ResolvedConfig, rtkStats?: RtkStats, totals?: () => TotalSavings): RuntimeState;
    getPublicTokenSaver(state: RuntimeState): PublicTokenSaver;
    getPublicLocalOptimize(state: RuntimeState): PublicLocalOptimize;
    updateTokenSaver(state: RuntimeState, patch: unknown): PublicTokenSaver;
    updateLocalOptimize(state: RuntimeState, patch: unknown): PublicLocalOptimize;
}
