/**
 * Shell command utilities for local responses.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
export declare const TWO_WORD_COMMANDS: Set<string>;
export declare const LISTING_COMMANDS: Set<string>;
export declare const READING_COMMANDS: Set<string>;
export declare function shellWords(command: string): string[];
export declare function isEnvAssignment(part: string): boolean;
export declare function stripEnvAssignments(parts: readonly string[]): string[];
export declare function extractCommandPrefix(command: string): string;
export declare function truncateOutput(output: string): string;
export declare function extractFilepathsFromCommand(command: string, _output?: string): string;
