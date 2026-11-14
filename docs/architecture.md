# Architecture

DSH Token Saver is a DSH bundle with a Host plugin and a Web client. The Host
plugin owns every token-saving decision. The client owns presentation only.

## Entry point

`src/index.ts` exports exactly one plugin form:

```ts
export const name = 'dsh-token-saver'
export const Config = TokenSaverSchema
export const inject = ['tools'] as const
export async function apply(rawScope, rawConfig): Promise<void>
```

There is no default export and no object export. `tools` is the only required
service. Everything else is optional and resolved lazily, so a Host without a
Web server or a token meter still loads the plugin.

## Extension points

| DSH surface | Kind | What the plugin does |
|---|---|---|
| `tools/post-execute` | Waterfall | Trims, folds, or compacts the tool result, then delegates to `next()` and merges only the text it changed |
| `agent/pre-step` | Waterfall | Reads context pressure and may ask the selected compaction engine to compact before the step |
| `ctx.systemPrompt.section()` | Section | Registers `token-saver:prompt-shaping` at order `9500`, with a text provider re-evaluated on every assembly |
| `llm/stream` | Waterfall | Returns a synthetic stream for recognized local probes; otherwise delegates to `next()` |
| `ctx.webServer.register()` | HTTP route | Serves the settings API under the `/api/token-saver` prefix |

The plugin does not listen to `system-prompt/assemble`, does not rewrite the
request object passed to `llm/stream`, and does not mutate another plugin's
service. Those were deliberate choices: the agent-loop request is deep-frozen,
the assemble waterfall is not the supported way to add text, and compaction is a
capability seam whose provider is selected in `cordis.yml`.

## Data flow

```
tool executes
  -> tools/post-execute
     -> decidePostTool()
        -> RTK filter (opt-in)
        -> grep folding (grep-like tools)
        -> head/tail truncation (everything else)
     -> next() returns the upstream decision
     -> merge trimmed content into the upstream decision
  -> model step

model step requested
  -> agent/pre-step
     -> read pressure from tokenMeter
     -> delegate to next()
     -> optionally call compaction.compactIfNeeded()

model call
  -> llm/stream
     -> local detector matches? return synthetic stream
     -> otherwise next()

system prompt assembly
  -> registered section text provider
     -> Caveman/Ponytail text, or empty string
```

## Module map

| Path | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry, hook wiring, accessors, public re-exports |
| `src/config.ts` | Config type, defaults, validation, resolution |
| `src/settings.ts` | Stored settings, runtime state, public API views |
| `src/stats-store.ts` | Persistent byte totals and prompt counters |
| `src/routes.ts` | JSON HTTP handler for the settings API |
| `src/strategies/tool-result-trim.ts` | Tool-output decision and content rebuild |
| `src/strategies/context-pressure.ts` | Pre-step pressure decision |
| `src/strategies/llm-summary.ts` | Exported compaction engine class, not auto-wired |
| `src/strategies/prompt-cache.ts` | Exported stabilization helper, not applied |
| `src/lib/truncate.ts` | Byte-budget head/tail truncation |
| `src/lib/fold-grep.ts` | Match-aware grep folding |
| `src/rtk/` | Filter registry, autodetection, and 13 structured-output filters |
| `src/prompt-shaping/` | Caveman and Ponytail prompt text |
| `src/local-responses/` | Probe detectors, command helpers, synthetic stream |
| `src/token-saver/` | Shared pipeline types and formatting helpers |
| `client.js` | Web settings page, registered through the DSH client module loader |
| `cordis.patch.yml` | Bundle patch that inserts the plugin row |

## Lifecycle

All registrations happen inside `apply` and belong to the Cordis scope:

- `scope.on(...)` listeners are removed automatically when the plugin unloads.
- The web route and the prompt section return disposers, and both are wrapped in
  `scope.effect(() => () => dispose())`.
- Runtime state is created once per activation. Changing settings from the Web
  panel updates that state in place; changing bundle configuration requires a
  reload, as with any Cordis plugin.

## Invariants

These are load-bearing. A change that breaks one of them is a bug even if the
tests pass.

1. **The agent-loop request is read-only.** `llm/stream` options arrive frozen.
   The plugin reads them and never writes to them.
2. **Error results are never compacted.** `result.isError` short-circuits the
   tool-output path and preserves the original content.
3. **A replacement must be non-empty and strictly smaller.** RTK and truncation
   both enforce this before returning a decision.
4. **Only tool output is compacted.** Prompt shaping adds text; it never cuts
   user or assistant messages.
5. **Local answers report zero real usage.** The stream says `inputTokens: 0`
   and `outputTokens: 0`, because no upstream model was called.
6. **Every path fails open.** A thrown error yields `{ kind: 'accept' }` with the
   original result, never a partial rewrite.
7. **Invalid configuration fails activation.** The `~standard` validator returns
   issues for bad values, and Cordis rejects the load.
8. **Statistics are UTF-8 bytes.** They are not model tokens and must never be
   presented as token counts.

## Non-goals

The plugin does not summarize conversation history itself, does not replace the
compaction provider, does not intercept network traffic, and does not edit the
DSH profile. Those belong to other seams and other owners.
