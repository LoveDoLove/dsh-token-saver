# Tool output compression

Tool output is the largest and least predictable source of context growth. A
single `read`, `grep`, or build log can add tens of thousands of bytes that stay
in the conversation for every later turn. This plugin compresses that output at
the `tools/post-execute` boundary, before it reaches the model.

## Decision order

For each non-error tool result:

1. **Skip** when the mode is `off`, the tool is excluded, or an include list is
   present and the tool is not on it.
2. **RTK pass** when `rtkEnabled` is true. A structured filter may replace the
   text, but only with a non-empty, strictly smaller result.
3. **Grep folding** for grep-like tools that RTK did not compress.
4. **Head/tail truncation** for everything else, or as the fallback when grep
   folding has no usable pattern.
5. **Rebuild** the content blocks and return an `accept` decision only when the
   new text is smaller than the original.

Results at or below `headBytes + tailBytes + 256` are left untouched unless RTK
compressed them.

## Head and tail truncation

`src/lib/truncate.ts` keeps a byte budget from each end and inserts a marker
that states how much was omitted. With `preserveStructure: true` (the default)
cuts land on line boundaries, so the model does not receive half a line. The
implementation measures UTF-8 bytes, not JavaScript string length, so CJK
content is not over-kept by a factor of three.

The marker is explicit:

```
[... content trimmed to save tokens: 148.3KB omitted; full result available via `result.full` if your tool exposes it ...]
```

The marker tells the model that the result is incomplete. It does not claim the
omitted content is unavailable when the underlying tool cannot retrieve it.

## Grep folding

`src/lib/fold-grep.ts` keeps matching lines plus `grepContextLines` around each
match, up to `grepMaxMatches`. Gaps collapse into a single marker that states how
many non-matching lines and how many further matches were omitted. The result is
then bounded by `grepHeadBytes + grepTailBytes`.

The pattern comes from `exec.arguments.pattern` when the harness provides it. A
pattern wrapped in slashes is compiled once as a RegExp; any other pattern is a
literal substring. If compilation fails, the matcher falls back to a literal
substring rather than throwing. When no pattern is available, folding degrades to
head/tail truncation.

Compiling the matcher once, outside the per-line loop, removes a ReDoS hazard
from model-supplied patterns.

## RTK filters

RTK is a set of lossy filters for structured command output. It is opt-in
(`rtkEnabled: true`) because a filter that guesses the format can damage prose.

| Filter | Targets |
|---|---|
| `git-diff` | Unified diffs; bounded hunks and a retrievability marker |
| `git-status` | Porcelain status; bounded file lists |
| `git-log` | Commit logs; bounded entries |
| `grep` | Grep output grouped by file, per-file cap |
| `find` | Find output grouped by directory, per-directory cap |
| `ls` | Directory listings with noise directories removed |
| `tree` | Tree output with a line cap |
| `dedup-log` | Repeated log lines collapsed with counts |
| `smart-truncate` | Long generic text with head and tail |
| `read-numbered` | Numbered file reads |
| `search-list` | Search result lists |
| `build-output` | Compiler and test output, errors and warnings retained |
| `table` | CLI table output |

Aliases: `rg` and `ripgrep` resolve to `grep`, `fd` resolves to `find`.

Autodetection samples the first 1 KiB of a result. It is disabled for read-like
tools (`read`, `cat`, `file_read`, `get_file`, `view`, `fetch`, `http_get`,
`curl`) because arbitrary file or response bodies are not structured command
output. An explicit per-tool filter still applies to those tools. This guard was
added after a README matched the `git-status` heuristic and lost 85% of its
content.

`compressText` also enforces a 500-character floor and a 10 MiB ceiling. Below
the floor the filter overhead exceeds the savings; above the ceiling the plugin
declines to process the payload.

## Multi-block results

A tool result may contain several text blocks. The plugin aggregates them, runs
one compression pass, then redistributes the compacted text in proportion to each
block's original UTF-8 byte share. The redistribution lands on character
boundaries and never duplicates or drops bytes. Non-text blocks are preserved,
and explicit `undefined` keys are stripped so the result still passes DSH's
lossless JSON snapshot.

## Safety rules

- **Errors are never compacted.** `result.isError` returns the original content.
- **No growth.** A decision is returned only when the replacement is smaller.
- **No empty replacements.** A filter that produces empty text is rejected.
- **Fail open.** Any exception returns `{ kind: 'accept' }`, leaving the result
  untouched.
- **Upstream wins.** If `next()` returns a block decision or a structured value,
  the plugin does not overwrite it.

## Measuring the effect

The published figures are UTF-8 byte reductions on synthetic input, produced
in-process. They are not token counts and say nothing about task quality. See
[benchmark results](benchmark-results.md) for the numbers, workloads, and which
rows are reproducible.
