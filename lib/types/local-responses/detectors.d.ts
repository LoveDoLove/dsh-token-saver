/**
 * Detectors for the five local response optimizations.
 * Ported and adapted from dsh-our-free-model / open-sse/rtk under MIT license.
 *
 * Supports both DSH GenerateOptions and Anthropic wire request shapes.
 */
import type { LocalOptimizationKind } from '../types.js';
export declare const OPTIMIZATIONS: readonly LocalOptimizationKind[];
export declare const LOCAL_RESPONSE_KINDS: readonly LocalOptimizationKind[];
export interface LocalAnswerUsage {
    readonly input?: number;
    readonly output?: number;
    readonly input_tokens?: number;
    readonly output_tokens?: number;
}
export declare function makeUsage(input: number, output: number): LocalAnswerUsage;
export interface LocalAnswer {
    readonly kind: LocalOptimizationKind;
    readonly text: string;
    readonly usage: LocalAnswerUsage;
    readonly model?: string;
}
export interface RequestMessageLike {
    readonly role?: string;
    readonly content?: unknown;
}
export interface RequestLike {
    readonly messages?: readonly RequestMessageLike[];
    readonly system?: unknown;
    readonly tools?: readonly unknown[];
    readonly maxTokens?: number;
    readonly max_tokens?: number | string;
    readonly purpose?: string;
    readonly model?: string;
    readonly provider?: string;
}
export declare function textOf(content: unknown): string;
export declare function systemText(request: RequestLike | undefined): string;
export declare function singleUserTurn(request: RequestLike | undefined): RequestMessageLike | undefined;
export declare function hasTools(request: RequestLike | undefined): boolean;
export declare function quotaAnswer(request: RequestLike | undefined): LocalAnswer | null;
export declare function prefixAnswer(request: RequestLike | undefined): LocalAnswer | null;
export declare function titleAnswer(request: RequestLike | undefined): LocalAnswer | null;
export declare function suggestionAnswer(request: RequestLike | undefined): LocalAnswer | null;
export declare function filepathAnswer(request: RequestLike | undefined): LocalAnswer | null;
export declare const DETECTORS: Record<LocalOptimizationKind, (req: RequestLike | undefined) => LocalAnswer | null>;
export declare function detectOptimization(request: RequestLike | undefined, enabledKinds?: ReadonlySet<LocalOptimizationKind>): LocalAnswer | null;
/**
 * Try detecting any enabled local response optimization.
 */
export declare function tryLocalResponses(request: RequestLike | undefined, enabled?: Partial<Record<LocalOptimizationKind, boolean>>): LocalAnswer | null;
/**
 * Convenient alias for tryLocalResponses.
 */
export declare const detectLocalResponse: typeof tryLocalResponses;
