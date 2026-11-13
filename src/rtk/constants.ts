/**
 * RTK (Rust Token Killer) constants and thresholds.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

export const RAW_CAP = 10 * 1024 * 1024 // 10 MiB ceiling
export const MIN_COMPRESS_SIZE = 500 // chars; below this, overhead > savings
export const DETECT_WINDOW = 1024 // chars inspected at head of blob

export const GIT_DIFF_HUNK_MAX_LINES = 100
export const GIT_LOG_MAX_LINES = 200
export const STATUS_MAX_FILES = 20
export const STATUS_MAX_UNTRACKED = 10

export const GREP_PER_FILE_MAX = 10
export const FIND_PER_DIR_MAX = 10
export const FIND_TOTAL_DIR_MAX = 50

export const LS_NOISE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.cache',
  '__pycache__',
])

/**
 * Stamped on compacted git-diff output.
 *
 * Two jobs, and the second is the load-bearing one: it tells the model the
 * uncompacted diff is still retrievable, and it lets the autodetector
 * recognise the output as already-compacted. Without it, a diff that was
 * restructured but not truncated carries no trace of the first pass, and the
 * second pass (llm/stream) re-detects the header-less hunks as generic text
 * and truncates the wreckage again — 900 files collapsed to a few hundred
 * bytes with the model told that was the whole diff.
 */
export const RTK_DIFF_MARKER = '[full diff: rtk git diff --no-compact]'

export const DEDUP_LINE_MAX = 1000
export const SMART_TRUNCATE_MIN_LINES = 50
export const SMART_TRUNCATE_HEAD = 20
export const SMART_TRUNCATE_TAIL = 20
export const READ_NUMBERED_MIN_HIT_RATIO = 0.6
export const SEARCH_LIST_PER_DIR_MAX = 10
export const SEARCH_LIST_TOTAL_DIR_MAX = 20

export const BUILD_OUTPUT_MAX_ERRORS = 50
export const BUILD_OUTPUT_MAX_WARNINGS = 50
export const DEPRECATION_KEEP = 3
export const TREE_MAX_LINES = 1000
