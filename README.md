# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**A configurable token-efficiency plugin for DeepSeek Harness (DSH).**

[简体中文](README.zh-CN.md) · [Releases](https://github.com/LoveDoLove/dsh-token-saver/releases) · [Issues](https://github.com/LoveDoLove/dsh-token-saver/issues)

Large tool results (file reads, grep dumps, command logs) consume most of a DSH session's context before the model ever needs all of it. DSH Token Saver trims that output and offers optional prompt shaping, context-pressure handling, local responses, and LLM-summary compaction. Optimizations are configurable and disabled or conservative by default where appropriate.

**Quick install.** Run `dsh plugin --profile web add github:LoveDoLove/dsh-token-saver`. See [Install](#install) for pinned releases and build-script approval.

## Features

| Feature | Description | Default |
|---|---|---|
| Tool-output trimming | Keeps the head and tail of oversized tool results | Enabled in conservative mode |
| Grep folding | Folds large grep results while retaining useful context | Enabled in conservative mode |
| Context-pressure handling | Tracks context pressure and can trigger compaction in higher modes | Conservative mode |
| RTK integration | Compacts supported command output through RTK | Off |
| Caveman prompt shaping | Uses a configurable terse prompt style | Off |
| Ponytail prompt shaping | Applies a minimal-change task-solving style | Off |
| Local responses | Answers supported probe shapes locally without an LLM call | Off |
| LLM-summary compaction | Optionally uses an LLM summary for compaction | Off |
| Prompt-cache stability | Optionally stabilizes system-prompt section ordering | Off |
| Web settings | Configure the plugin from **Settings → Token Saver** | Available on DSH Web |

## Install

Install from the GitHub repository with DSH:

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

If your DSH installation asks for build-script approval, follow the approval instructions printed by DSH/pnpm and retry the install. Then reload or restart the target DSH profile as required by your installation.

> The GitHub repository and GitHub Releases are the source of truth for this project. Use a version-pinned release when one is available.

Install the current v1.0.2 release explicitly:

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.2
```

The prebuilt artifact `dsh-token-saver-1.0.2.tgz` is also available from the [v1.0.2 release](https://github.com/LoveDoLove/dsh-token-saver/releases/tag/v1.0.2) and can be installed as a local package without a local build environment.


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

### Modes

- **off** — disables token-saving transformations.
- **conservative** — trims/folds oversized tool output while retaining the normal DSH compaction path.
- **balanced** — enables additional context-pressure handling.
- **aggressive** — enables more extensive compaction behavior; review the configuration before enabling it.

Exact behavior depends on the individual options and the installed DSH version. Check the settings panel and configuration defaults for the current build.

## Benchmarks

This project does not publish synthetic benchmark results. Savings are measured from real DSH sessions through the persisted telemetry described in [Statistics](#statistics); see [Benchmark methodology](docs/benchmark-methodology.md) for how to reproduce and report measurements.

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

Verified byte-reduction measurements on plugin v1.0.2 (DSH 0.2.1-rc.2, Node v24.22.0, Linux, mode `conservative`, `rtkEnabled: false`). Full methodology and reproducible commands are in [docs/benchmark-results.md](docs/benchmark-results.md).

| Scenario | Input bytes | Output bytes | Bytes saved | Reduction |
|---|---:|---:|---:|---:|
| Read-like tool output (head + tail) | 182,892 | 24,675 | 158,217 | 86.5% |
| Grep-like tool output (production path, pattern supplied) | 29,321 | 8,145 | 21,176 | 72.2% |
| Grep-like tool output (production path, no pattern — fail-open) | 29,321 | 12,321 | 17,000 | 58.0% |
| Grep folding with a supplied pattern (library capability, 19,781-byte input) | 19,781 | 1,301 | 18,480 | 93.4% |
| RTK build-output compaction | 9,423 | 2,163 | 7,260 | 77.0% |

These are UTF-8 byte reductions of synthetic input passed through the compaction functions in-process. They are not model token counts, token-cost savings, latency improvements, or task-quality evidence. In production today the grep path does not receive a search pattern, so the 93.4% figure is the library's capability, not the default behavior.

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
