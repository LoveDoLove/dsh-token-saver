# Statistics

The dashboard reports how much text the plugin removed and how many times it ran.
All size figures are **UTF-8 bytes**, not model tokens. They do not convert
one-to-one into token counts or billing.

## Counters

| Counter | Meaning |
|---|---|
| `bytesBefore` | Original size of every compacted result |
| `bytesAfter` | Size after compaction |
| `saved` | `bytesBefore - bytesAfter` |
| `percent` | `saved / bytesBefore`, rounded and clamped to 0-100 |
| `calls` | Invocations that produced at least one compacted block |
| `blocks` | Text blocks actually compacted |
| `promptCalls` | Model steps whose system prompt carried shaping text |

One request that compacts three blocks advances `calls` by one and `blocks` by
three. A request with no hit records nothing and does not touch the file.

`promptCalls` is separate because a shaped prompt saves no bytes at the moment
it is injected. It is the only place a prompt-only step appears.

## What is counted

A tool result is recorded only when the compacted text actually reaches the
model. If `next()` returns a block decision or a structured value, the plugin
does not overwrite it and does not count savings. A per-call accumulator is
merged into the totals once, so one result is never counted twice.

## Storage

```
$DSH_HOME/token-saver/stats.json
```

`DSH_HOME` defaults to `~/.dsh`. The file is JSON:

```json
{
  "bytesBefore": 212314,
  "bytesAfter": 39281,
  "saved": 173033,
  "calls": 42,
  "blocks": 57,
  "promptCalls": 18
}
```

Every read and write fails open. A missing file, invalid JSON, or write error
starts from zero or keeps the in-memory totals, and never throws into a request
path.

Settings live in a sibling file, `settings.json`. They are written by the Web
panel, not by the stats store.

## API

The same figures are available over the settings API:

```
GET /api/token-saver
```

The response includes `savings` with `bytesBefore`, `bytesAfter`, `saved`,
`percent`, `blocks`, `calls`, `promptCalls`, and a human-readable `summary` such
as `42 calls · 81% (169.0 KB) saved`.

## Reading the dashboard honestly

The panel labels a few values with product language ("Tokens Saved"). The stored
values are bytes. Treat them as a relative indicator of how much text was
removed, not as a token budget or a cost estimate. The benchmark documents follow
the same rule.
