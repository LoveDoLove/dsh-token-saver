# Benchmark methodology

This document defines how savings from DSH Token Saver are measured and reported. It describes the protocol, not results. The project publishes no synthetic benchmarks and no performance claims that were not produced with the procedure below.

## What is measured

DSH Token Saver reports byte reduction of text that passes through its compaction paths:

- **Tool-output trimming** keeps the head and tail of oversized tool results and drops the middle.
- **Grep folding** folds large grep results while retaining surrounding context.
- **RTK compaction** rewrites supported command output through a structured filter.

Savings are measured in UTF-8 bytes, not model tokens. Byte counts are stable across tokenizers and require no tokenizer dependency, but they do not translate one-to-one into token counts or billing.

## Metrics

The counters below are the same ones the Web settings panel displays and the ones persisted to `~/.dsh/token-saver/stats.json` (or `$DSH_HOME/token-saver/stats.json` when `DSH_HOME` is set).

| Field | Meaning |
|---|---|
| `bytesBefore` | Total UTF-8 bytes of content entering the compaction paths |
| `bytesAfter` | Total UTF-8 bytes of content leaving those paths |
| `saved` | `bytesBefore - bytesAfter`, accumulated per pass |
| `calls` | Compaction events that produced at least one trimmed block |
| `blocks` | Text blocks that were actually compacted |
| Saved ratio | `saved / bytesBefore`, shown as a percentage |

The same tool output can be compacted twice, once by the `tools/post-execute` hook and again by the `llm/stream` path on the already-compacted text. `calls` therefore counts events, `blocks` counts compacted text, and `saved` stays exact because per-pass savings add up to the total.

## Protocol

1. **Pin the build.** Record the plugin version, the DSH version, Node.js version, and operating system. Use a tagged release or a named commit; never report against a dirty working tree.
2. **Pin the configuration.** Record `mode` and every option that can alter compaction (`rtkEnabled`, `cavemanLevel`, `ponytailLevel`, `localResponsesEnabled`, `llmSummaryEnabled`). A measurement without its configuration cannot be reproduced or compared.
3. **Start from a known counter state.** Either delete `stats.json` before the run or record its contents first, so the delta is unambiguous.
4. **Run a reproducible workload.** Use a fixed task script, prompt set, or command sequence, and record it alongside the numbers. Interactive sessions are acceptable when the transcript is included.
5. **Read the deltas, not the absolute totals.** Compute the difference in `bytesBefore`, `bytesAfter`, `saved`, `calls`, and `blocks` between the start and end of the run.
6. **Repeat at least three times.** Report each run and the median. A single run is an anecdote, not a measurement.
7. **Report the comparison honestly.** When comparing a configuration against the plugin disabled, keep the workload, host, and DSH version identical, and change only the plugin settings.

## Worked procedure

The following isolates a run from any existing telemetry store. It writes counters to a throwaway directory and removes them afterwards.

```bash
export DSH_HOME="$(mktemp -d)"
# run the fixed workload in DSH with the target configuration
cat "$DSH_HOME/token-saver/stats.json"
rm -rf "$DSH_HOME"
```

Read the same fields from the Web panel under **Settings → Token Saver** when a shell is not available. The panel and `stats.json` report the same counters.

## Reporting template

Copy this block into a release note, pull request, or issue. Fill in only values you actually observed.

```text
Plugin: dsh-token-saver <version or commit>
DSH: <version>   Node.js: <version>   OS: <name and version>
Mode: <off|conservative|balanced|aggressive>
Options: rtk=<on|off> caveman=<level> ponytail=<level> localResponses=<on|off> llmSummary=<on|off>
Workload: <transcript path, script, or prompt set>

Run 1: saved=<n> bytesBefore=<n> savedRatio=<n>% calls=<n> blocks=<n>
Run 2: saved=<n> bytesBefore=<n> savedRatio=<n>% calls=<n> blocks=<n>
Run 3: saved=<n> bytesBefore=<n> savedRatio=<n>% calls=<n> blocks=<n>
Median saved ratio: <n>%
```

## What this method cannot show

- **Task quality.** Byte reduction says nothing about whether the model still had the information it needed. Aggressive modes can remove content that mattered.
- **Token or cost savings.** Byte counts do not convert directly to tokens, and token counts do not convert directly to billing.
- **Latency.** The measurement does not time compaction or request execution.
- **Generalization.** A ratio measured on one workload does not transfer to another. Report the workload with the number.

## Citing a figure

When a number appears in documentation or a release note, it must carry its configuration, workload, and build. Any figure without that context is treated as an unverified claim and should be removed rather than repeated.
