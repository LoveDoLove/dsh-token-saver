import type { CavemanLevel, LocalOptimizationKind, PonytailLevel, SessionMode, TokenSaverConfig } from './types.js';
export type { SessionMode, TokenSaverConfig, CavemanLevel, PonytailLevel, LocalOptimizationKind };
export interface ResolvedConfig {
    readonly mode: SessionMode;
    readonly preserveStructure: boolean;
    readonly headBytes: number;
    readonly tailBytes: number;
    readonly grepMaxMatches: number;
    readonly grepContextLines: number;
    readonly grepHeadBytes: number;
    readonly grepTailBytes: number;
    readonly pressureThreshold: number;
    readonly compactPressureThreshold: number;
    readonly llmSummaryEnabled: boolean;
    readonly llmSummaryPrompt: string;
    readonly llmSummaryMaxInputTokens: number;
    readonly replaceBasicCompaction: boolean;
    readonly includeToolNames: readonly string[];
    readonly excludeToolNames: readonly string[];
    readonly cacheStableSections: readonly string[];
    readonly telemetry: TokenSaverConfig['telemetry'];
    readonly rtkEnabled: boolean;
    readonly cavemanLevel: CavemanLevel;
    readonly ponytailLevel: PonytailLevel;
    readonly localResponsesEnabled: boolean;
    readonly localResponses: ReadonlySet<LocalOptimizationKind>;
}
export declare const DEFAULTS: ResolvedConfig;
export declare function resolveConfig(input: TokenSaverConfig | undefined): ResolvedConfig;
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => {
        readonly value: Output;
        readonly issues?: undefined;
    } | {
        readonly issues: ReadonlyArray<{
            readonly message: string;
            readonly path?: ReadonlyArray<PropertyKey>;
        }>;
    };
}
export interface ConfigDescriptor {
    readonly '~standard': StandardSchemaV1Props<unknown, TokenSaverConfig>;
    readonly name: string;
    readonly fields: Readonly<Record<keyof ResolvedConfig | 'mode', 'string' | 'number' | 'boolean' | 'enum'>>;
    readonly validate: (input: unknown) => TokenSaverConfig;
    readonly resolve: (input: TokenSaverConfig) => ResolvedConfig;
}
export declare const TokenSaverSchema: ConfigDescriptor;
