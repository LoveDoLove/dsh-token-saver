# DSH Token Saver

<div align="center">
  <a href="https://trendshift.io/repositories/312537"><img src="docs/images/trendshift.svg" alt="DSH Token Saver on Trendshift" width="250" height="55"></a>
</div>

**Keep more of your context window for the model.**
A DeepSeek Harness plugin that trims oversized tool output, folds grep results,
and makes prompt shaping and local answers optional.

[简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Releases](https://github.com/LoveDoLove/dsh-token-saver/releases) · [Issues](https://github.com/LoveDoLove/dsh-token-saver/issues)

## Why

Tool output fills a context window faster than anything else. One file read, one
`grep`, or one build log can add tens of thousands of bytes the model never
needed, and those bytes stay in the conversation for every later turn.

Token Saver works at the DSH tool-execution boundary. It keeps the head and tail
of long results, folds search output down to its matches, and can apply
shape-aware RTK filters. It never touches user messages, assistant messages, or
errors, and it fails open: a compaction error returns the original result.

## Features

| Feature | What it does | Default |
|---|---|---|
| Tool-output trimming | Keeps the head and tail of oversized results | On |
| Grep folding | Keeps matches plus context | On |
| RTK filters | Shape-aware compaction for diffs, logs, trees, tables | Off |
| Caveman shaping | Terse, direct answers with exact code and paths | Off |
| Ponytail shaping | Minimal-change, smallest-diff style | Off |
| Local responses | Answers quota, prefix, title, suggestion, filepath probes | Off |
| Context pressure | Triggers compaction above a threshold | Off |
| Web panel | Settings and savings in **Settings → Token Saver** | On DSH Web |

Every feature can be turned off. `mode: off` disables all tool-output
compaction; prompt shaping and local responses have their own switches.

## Quick start

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

Pin the current release:

```bash
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver#v1.0.5
```

If DSH asks for build-script approval, follow the printed instructions and retry.
The prebuilt `dsh-token-saver-1.0.5.tgz` on the
[v1.0.5 release](https://github.com/LoveDoLove/dsh-token-saver/releases/tag/v1.0.5)
installs without a local build.

> **Upgrading from v1.0.4 or older?** v1.0.5 fixes a data-destruction bug in RTK
> autodetection that could collapse README-style prose. Upgrade if you read files
> through a tool.

## Configuration

Configuration lives in the bundle row in your DSH profile. A typical setup:

```yaml
- id: dsh-token-saver
  name: dsh-token-saver
  config:
    mode: conservative
    headBytes: 16384
    tailBytes: 8192
    rtkEnabled: false
    cavemanLevel: off
    ponytailLevel: off
    localResponsesEnabled: false
```

| Mode | Behavior |
|---|---|
| `off` | No trimming, folding, or RTK |
| `conservative` | Trim and fold only; never compacts the session |
| `balanced` | Adds pressure-driven compaction when enabled |
| `aggressive` | Same as balanced, with a lower bar for compaction |

The Web panel writes live overrides to `$DSH_HOME/token-saver/settings.json`.
See [configuration](docs/configuration.md) for all 22 options.

## How it works

1. **`tools/post-execute`** — decide whether a result should be compacted. Errors
   and structured values pass through.
2. **Strategy** — RTK filter, grep fold, or byte-budget truncation, whichever fits
   the tool and the result.
3. **`ctx.systemPrompt.section()`** — add Caveman or Ponytail text as a prompt
   section. The frozen LLM request is never rewritten.
4. **`llm/stream`** — answer a recognized probe locally with zero usage; otherwise
   pass through.

## Safety

- Errors are never compacted.
- Output is accepted only when it is non-empty and strictly smaller.
- Every strategy fails open.
- Prompt text uses the supported section API, not the assembly waterfall.
- The agent-loop LLM request is never mutated.
- Invalid configuration fails activation instead of being silently coerced.

## Benchmark

UTF-8 bytes on synthetic fixtures:

| Fixture | Before | After | Saved |
|---|---:|---:|---:|
| Large diff | 182,892 | 24,675 | 86.5% |
| Grep result | 29,321 | 8,145 | 72.2% |
| Find result | 29,321 | 12,321 | 58.0% |
| Build log | 19,781 | 1,301 | 93.4% |
| Table | 9,423 | 2,163 | 77.0% |

Bytes are not tokens. Method: [benchmark-methodology](docs/benchmark-methodology.md).

## Documentation

- [Whitepaper](docs/whitepaper.md) · [白皮书](docs/whitepaper.zh-CN.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Tool-output compression](docs/tool-output-compression.md)
- [Prompt shaping](docs/prompt-shaping.md)
- [Local responses](docs/local-responses.md)
- [Statistics](docs/statistics.md)
- [Compatibility](docs/compatibility.md)
- [Development](docs/development.md)

## Compatibility

Targets DSH `>=0.2.0 <0.3.0` and Node `>=22.19.0`. Works alongside Billion
Context, OmniRoute, and Our Free Model. Details:
[compatibility](docs/compatibility.md).

## Development

```bash
pnpm install
pnpm prepack
```

`pnpm prepack` runs lint, typecheck, tests, build, and package verification.
Agent guidance: [AGENTS.md](AGENTS.md).

## License

MIT
