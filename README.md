# DSH Token Saver

**A configurable token-efficiency plugin for DeepSeek Harness (DSH).**

[简体中文](README.zh-CN.md) · [Releases](https://github.com/LoveDoLove/dsh-token-saver/releases) · [Issues](https://github.com/LoveDoLove/dsh-token-saver/issues)

DSH Token Saver reduces unnecessary context from verbose tool output and offers optional prompt shaping, context-pressure handling, local responses, and LLM-summary compaction. Optimizations are configurable and disabled or conservative by default where appropriate.

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
