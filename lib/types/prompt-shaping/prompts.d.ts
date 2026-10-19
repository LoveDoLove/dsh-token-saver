/**
 * Prompt Shaping: Caveman & Ponytail prompts.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Caveman: Compresses the ANSWER (grammar and pleasantries traded for output tokens).
 * Ponytail: Compresses the WORK (YAGNI, smallest change, simple code).
 */
import type { CavemanLevel, PonytailLevel } from '../types.js';
export declare const CAVEMAN_LEVELS: readonly CavemanLevel[];
export declare const PONYTAIL_LEVELS: readonly PonytailLevel[];
export declare function cavemanPrompt(level: CavemanLevel | string | undefined): string | null;
export declare function ponytailPrompt(level: PonytailLevel | string | undefined): string | null;
export interface ActivePrompt {
    readonly id: 'caveman' | 'ponytail';
    readonly level: string;
    readonly text: string;
}
export declare function activePrompts(levels: {
    caveman?: CavemanLevel | string;
    ponytail?: PonytailLevel | string;
}): ActivePrompt[];
