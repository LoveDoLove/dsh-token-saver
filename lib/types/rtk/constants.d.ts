/**
 * RTK (Rust Token Killer) constants and thresholds.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
export declare const RAW_CAP: number;
export declare const MIN_COMPRESS_SIZE = 500;
export declare const DETECT_WINDOW = 1024;
export declare const GIT_DIFF_HUNK_MAX_LINES = 100;
export declare const GIT_LOG_MAX_LINES = 200;
export declare const STATUS_MAX_FILES = 20;
export declare const STATUS_MAX_UNTRACKED = 10;
export declare const GREP_PER_FILE_MAX = 10;
export declare const FIND_PER_DIR_MAX = 10;
export declare const FIND_TOTAL_DIR_MAX = 50;
export declare const LS_NOISE_DIRS: Set<string>;
export declare const DEDUP_LINE_MAX = 1000;
export declare const SMART_TRUNCATE_MIN_LINES = 50;
export declare const SMART_TRUNCATE_HEAD = 20;
export declare const SMART_TRUNCATE_TAIL = 20;
export declare const READ_NUMBERED_MIN_HIT_RATIO = 0.6;
export declare const SEARCH_LIST_PER_DIR_MAX = 10;
export declare const SEARCH_LIST_TOTAL_DIR_MAX = 20;
export declare const BUILD_OUTPUT_MAX_ERRORS = 50;
export declare const BUILD_OUTPUT_MAX_WARNINGS = 50;
export declare const DEPRECATION_KEEP = 3;
export declare const TREE_MAX_LINES = 1000;
