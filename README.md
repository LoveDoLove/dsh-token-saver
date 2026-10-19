# dsh-token-saver

DeepSeek Harness plugin: aggressive token optimization without affecting task quality. Trims tool results with RTK, prompt shaping via Caveman & Ponytail, instant local responses, manages context-window pressure, optional LLM-summary compaction, and a stable prompt-cache layout.

Works globally across all supported DSH requests — not just through the Our Free Model gateway.

## Features

| Feature | What it does | Config keys | Default |
|---|---|---|---|
| **RTK tool-output compaction** | Detects and compacts verbose tool outputs (git diff/status/log, grep, find, ls, tree, build logs, …) before they enter context | `rtkEnabled` | `false` |
| **Caveman** | Compresses system prompt wording to a terse style | `cavemanLevel` (`off`/`lite`/`full`/`ultra`/`wenyan-lite`/`wenyan`/`wenyan-ultra`) | `off` |
| **Ponytail** | Applies the lazy-senior-dev prompt-shaping strategy (smallest change that fully solves the task) | `ponytailLevel` (`off`/`lite`/`full`/`ultra`) | `off` |
| **Local responses** | Answers five canonical probe shapes locally with zero tokens: quota, prefix, title, suggestion, filepath | `localResponsesEnabled`, `localResponses` (subset) | `false` / all five |
| **Tool-result trim & fold** | Head/tail truncation and grep fold for large tool outputs | `mode`, `headBytes`, `tailBytes`, … | `conservative` |
| **Context pressure** | Monitors token-meter pressure and triggers compaction when over threshold | `mode` (`balanced`/`aggressive`), `pressureThreshold` | `0.5` |
| **LLM-summary compaction** | Optional compaction engine replacing basic compaction with an LLM summary | `llmSummaryEnabled` | `false` |
| **Prompt-cache stability** | Stable system-prompt section ordering for better cache hits | `cacheStableSections` | `[]` |

## Install

```bash
pnpm add dsh-token-saver
```

Then add to your DSH bundle patch (`cordis.patch.yml`):

```yaml
- insert:
    - id: dsh-token-saver
      name: dsh-token-saver
```

## Configuration

All options are independently configurable. Example:

```yaml
dsh-token-saver:
  mode: balanced        # off | conservative | balanced | aggressive
  rtkEnabled: true      # RTK tool-output compaction
  cavemanLevel: lite    # off | lite | full | ultra | wenyan-lite | wenyan | wenyan-ultra
  ponytailLevel: full   # off | lite | full | ultra
  localResponsesEnabled: true
  localResponses: [quota, prefix, title, suggestion, filepath]
  llmSummaryEnabled: false
```

### Defaults

```ts
{
  mode: 'conservative',
  preserveStructure: true,
  headBytes: 16384,
  tailBytes: 8192,
  grepMaxMatches: 30,
  grepContextLines: 2,
  grepHeadBytes: 8192,
  grepTailBytes: 4096,
  pressureThreshold: 0.5,
  compactPressureThreshold: 0.5,
  llmSummaryEnabled: false,
  llmSummaryPrompt: '',
  llmSummaryMaxInputTokens: 16000,
  replaceBasicCompaction: false,
  includeToolNames: [],
  excludeToolNames: [],
  cacheStableSections: [],
  rtkEnabled: false,
  cavemanLevel: 'off',
  ponytailLevel: 'off',
  localResponsesEnabled: false,
  localResponses: ['quota', 'prefix', 'title', 'suggestion', 'filepath'],
}
```

## Compatibility

Designed to coexist with:

- **Billion Context** — ACP markers and compressed summaries pass through untouched; RTK skips outputs containing ACP tags (idempotency guard).
- **OmniRoute** — request routing options (provider, model, tools) are preserved; no re-transformation of the same request.
- **Our Free Model** — detects the OFM marker (`<!-- ofm-token-saver -->`) and will not double-inject prompt shaping already applied by the gateway.

## Fail-open policy

Every optional optimization fails open: if a filter throws, returns a non-string, or produces a larger/empty output, the original content is preserved untouched. Error tool results are never compacted.

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run
pnpm lint       # oxlint src test
```

## License

MIT — see [LICENSE](./LICENSE). Portions ported from `dsh-our-free-model` (MIT, Copyright (c) 2026 Ebony-Vinyl) and `dsh-token-saver` reference implementation (MIT, Copyright (c) 2026 dsh-token-saver contributors), with attribution preserved.
