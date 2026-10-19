/**
 * Synthetic stream chunk generator for local responses.
 * Emits canonical DSH StreamChunk protocol items: block-start, text-delta, block-end, usage, finish.
 */
import type { LocalAnswer } from './detectors.js';
export interface LocalStreamChunk {
    readonly type: 'block-start' | 'text-delta' | 'block-end' | 'usage' | 'finish';
    readonly index?: number;
    readonly blockType?: string;
    readonly text?: string;
    readonly delta?: string;
    readonly block?: {
        readonly type: string;
        readonly text: string;
    };
    readonly usage?: {
        readonly inputTokens?: number;
        readonly outputTokens?: number;
        readonly input?: number;
        readonly output?: number;
    };
    readonly reason?: string | {
        readonly kind: string;
    };
}
export declare function createLocalResponseStream(answer: LocalAnswer): AsyncIterable<LocalStreamChunk>;
