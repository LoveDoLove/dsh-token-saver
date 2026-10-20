# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**Trim oversized tool output to keep more of your DSH context window for the model.**

A configurable token-efficiency plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It shrinks file reads, grep dumps, and command logs before they enter the conversation, and adds optional context-pressure handling, prompt shaping, local responses, and LLM-summary compaction.

[简体中文](README.zh-CN.md) · [Releases](https://github.com/LoveDoLove/dsh-token-saver/releases) · [Issues](https://github.com/LoveDoLove/dsh-token-saver/issues)

## Why

Tool output is the fastest way to fill a context window. A single file read or `grep` dump can add tens of thousands of bytes to a session, most of which the model never needed — and the tokens stay in the conversation for every later turn.

DSH Token Saver intercepts that output at the DSH tool-execution boundary: it keeps the head and tail of long results, folds grep output down to its matches, and compacts structured command output through RTK. Everything is configurable, and the extras (prompt shaping, RTK, local responses, LLM summaries) are off by default.

**Quick install.** Run `dsh plugin --profile web add github:LoveDoLove/dsh-token-saver`. See [Install](#install) for pinned releases and build-script approval.

## Features

| Feature | Description | Default |
|---|---|---|
| Tool-output trimming | Keeps the head and tail of oversized tool results | On in every mode except `off` |
| Grep folding | Folds large grep results while retaining useful context | On in every mode except `off` |
| Context-pressure handling | Tracks context pressure and can trigger compaction in higher modes | Off in `conservative`, on in `balanced`/`aggressive` |
| RTK integration | Compacts supported command output through RTK | Off |
| Caveman prompt shaping | Uses a configurable terse prompt style | Off |
| Ponytail prompt shaping | Applies a minimal-change task-solving style | Off |
| Local responses | Answers supported probe shapes locally without an LLM call | Off |
| LLM-summary compaction | Optionally uses an LLM summary for compaction | Off (only effective in `balanced`/`aggressive`) |
| Prompt-cache stability | Stabilizes system-prompt section ordering | Applies in every mode except `off` |
| Web settings | Configure the plugin from **Settings → Token Saver** | Available on DSH Web |

## Install

Install from the GitHub repository with DSH:

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

If your DSH installation asks for build-script approval, follow the approval instructions printed by DSH/pnpm and retry the install. Then reload or restart the target DSH profile as required by your installation.

> The GitHub repository and GitHub Releases are the source of truth for this project. Use a version-pinned release when one is available.

Install the current v1.0.3 release explicitly:

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.3
```

The prebuilt artifact `dsh-token-saver-1.0.3.tgz` is also available from the [v1.0.3 release](https://github.com/LoveDoLove/dsh-token-saver/releases/tag/v1.0.3) and can be installed as a local package without a local build environment.

> v1.0.3 includes the grep-pattern fix (commit `8562f48`). The v1.0.2 release predates it.

## How it works

DSH Token Saver hooks into the DSH tool-execution pipeline:

1. **Post-execute hook** — after a tool returns, oversized output is trimmed to head + tail or folded (grep results keep their matches; RTK compacts structured command output).
2. **Context-pressure handling** — when context pressure crosses the threshold, higher modes can trigger compaction before the next step.
3. **LLM-summary compaction** — in `balanced`/`aggressive` mode, an optional LLM summary can replace bulky output (requires a configured `callLlm` provider).
4. **Prompt-cache stability** — system-prompt sections are reordered so pinned, cacheable sections stay stable across turns.

All paths are fail-open: if an optimization errors, the original content is preserved unchanged.


## Configuration

The settings panel is available in DSH Web under **Settings → Token Saver**. You can also configure the plugin through its DSH bundle configuration.

Example:

```yaml
dsh-token-saver:
  mode: conservative # off | conservative | balanced | aggressive
  rtkEnabled: false
  cavemanLevel: off # off | lite | full | ultra | wenyan-lite | wenyan | wenyan-ultra
  ponytailLevel: off # off | lite | full | ultra
  localResponsesEnabled: false
  localResponses: [quota, prefix, title, suggestion, filepath]
  llmSummaryEnabled: false
```

### Key options

| Option | Default | Notes |
|---|---|---|
| `mode` | `conservative` | Master switch; see [Modes](#modes). |
| `headBytes` / `tailBytes` | `16384` / `8192` | Bytes kept from the start and end of a trimmed tool result. Results at or below `headBytes + tailBytes + 256` are left untouched. |
| `grepMaxMatches` / `grepContextLines` | `30` / `2` | Matches kept when folding a grep result, and the context lines kept around each match. |
| `grepHeadBytes` / `grepTailBytes` | `8192` / `4096` | Byte budget for the folded grep result. |
| `pressureThreshold` | `0.5` | Context-pressure ratio above which higher modes may compact. |
| `llmSummaryEnabled` | `false` | Only effective in `balanced` or `aggressive` mode, and only when a `callLlm` provider is wired in. |
| `replaceBasicCompaction` | `true` in `aggressive` | Replaces DSH's built-in compaction provider with the LLM-summary engine. |
| `includeToolNames` / `excludeToolNames` | `[]` | Restrict trimming to specific tools, or skip specific tools. |
| `cacheStableSections` | `[]` | System-prompt section ids to pin first, so they stay in a stable position for prompt caching. |

### Modes

- **off** — disables token-saving transformations. (RTK still runs when `rtkEnabled: true`.)
- **conservative** — trims/folds oversized tool output while retaining the normal DSH compaction path.
- **balanced** — enables additional context-pressure handling.
- **aggressive** — enables more extensive compaction behavior (including replacing the basic compaction provider by default); review the configuration before enabling it.

Exact behavior depends on the individual options and the installed DSH version. Check the settings panel and configuration defaults for the current build.

## Statistics

The Web settings panel shows live savings telemetry, and the totals are persisted to `~/.dsh/token-saver/stats.json` (or `$DSH_HOME/token-saver/stats.json`) so the dashboard still reports savings after a host restart.

- **Saved** — bytes reduced across all compaction passes.
- **Saved ratio** — saved bytes as a percentage of original bytes.
- **Calls** — compaction invocations that produced at least one trimmed block.
- **Blocks** — text blocks that were actually compacted.

The same tool output can be compacted twice — once by the post-execute hook and again by the LLM/stream path — so `calls` counts events and `blocks` counts compacted text. Saved bytes stay exact because per-pass savings add up to the total. Telemetry reads and writes are fail-open: a broken store must never affect compression behavior.

> v1.0.2 introduced persistent cumulative savings. Earlier versions reset the dashboard to zero on every restart.

## Safety behavior

- **Fail open:** if an optimization fails or produces an unusable result, the original content is preserved.
- **Error output is preserved:** tool results marked as errors are not compacted by the tool-output filter.
- **Opt-in extras:** RTK, prompt shaping, local responses, and LLM-summary compaction are independently configurable.
- **No quality guarantee:** token reduction can change the information visible to a model. Review settings carefully, especially for aggressive compaction.

## Benchmark

Verified byte-reduction measurements on plugin v1.0.3 (DSH 0.2.1-rc.2, Node v24.22.0, Linux, mode `conservative`, `rtkEnabled: false`). Every scenario is a deterministic in-process call on synthetic input — no DSH session and no LLM request are involved. Full methodology and reproducible commands are in [docs/benchmark-results.md](docs/benchmark-results.md); how to reproduce and report measurements is in [docs/benchmark-methodology.md](docs/benchmark-methodology.md).

| Scenario | Input bytes | Output bytes | Bytes saved | Reduction |
|---|---:|---:|---:|---:|
| Read-like tool output (head + tail) | 182,892 | 24,675 | 158,217 | 86.5% |
| Grep-like tool output (production path, pattern supplied) | 29,321 | 8,145 | 21,176 | 72.2% |
| Grep-like tool output (production path, no pattern — fail-open) | 29,321 | 12,321 | 17,000 | 58.0% |
| Grep folding with a supplied pattern (library capability, 19,781-byte input) | 19,781 | 1,301 | 18,480 | 93.4% |
| RTK build-output compaction | 9,423 | 2,163 | 7,260 | 77.0% |

These are UTF-8 byte reductions of synthetic input passed through the compaction functions in-process. They are not model token counts, token-cost savings, latency improvements, or task-quality evidence. The production grep path now extracts the search pattern from `exec.arguments` (commit `8562f48`); the 93.4% figure is the folding library's capability on a different, smaller input, not the default production-path result.

Reproducibility differs per row: the read-like, library-level, and RTK rows are reproduced by the committed `npx tsx bench-tmp.ts` script, while the two 29,321-byte production rows were measured on an input whose generator is not committed, so they cannot be re-run from this repository as committed. See [Reproducibility status](docs/benchmark-results.md#reproducibility-status) in the benchmark results document.

## Compatibility

Designed to coexist with:

- **Billion Context** — ACP-marked content is preserved by the relevant output filter.
- **OmniRoute** — request routing fields are intended to remain intact.
- **Our Free Model** — detects the `<!-- ofm-token-saver -->` marker to avoid applying prompt shaping twice.

Compatibility depends on the versions and configuration of the surrounding plugins. Report reproducible issues with version details.

## Development

Requirements: Node.js `>=22.19.0` and pnpm.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## License

MIT. See [LICENSE](LICENSE). Third-party-derived portions retain their required attribution; see the source and license notices for details.
