# Configuration

Configuration has two layers:

1. **Bundle configuration** in the DSH profile. These are the values declared in
   `cordis.patch.yml` or the profile's config editor, validated at activation.
2. **Stored settings** written by the Web panel to
   `~/.dsh/token-saver/settings.json` (or `$DSH_HOME/token-saver/settings.json`).
   These override four live switches: `enabled`, `rtk`, prompt levels, and local
   responses.

The stored layer exists because the panel must change behavior without editing
the profile. Bundle values still provide the starting point, and any option not
exposed by the panel is bundle-only.

## Full reference

| Option | Type | Default | Effect |
|---|---|---|---|
| `mode` | `off` \| `conservative` \| `balanced` \| `aggressive` | `conservative` | Master policy for tool-output trimming and pressure handling |
| `preserveStructure` | boolean | `true` | Cut head/tail at line boundaries instead of raw byte offsets |
| `headBytes` | number | `16384` | Bytes kept from the start of an oversized tool result |
| `tailBytes` | number | `8192` | Bytes kept from the end |
| `grepMaxMatches` | number | `30` | Matches retained when folding a grep result |
| `grepContextLines` | number | `2` | Context lines kept around each retained match |
| `grepHeadBytes` | number | `8192` | Head byte budget for a folded grep result |
| `grepTailBytes` | number | `4096` | Tail byte budget for a folded grep result |
| `pressureThreshold` | number | `0.5` | Pressure ratio that opens the compaction window |
| `compactPressureThreshold` | number | `0.5` | Pressure ratio that actually calls the compaction engine |
| `llmSummaryEnabled` | boolean | `false` | Resolves true only in `balanced`/`aggressive`; the engine itself is not wired |
| `llmSummaryPrompt` | string | `''` | Prompt used by the exported `LlmSummaryCompactionEngine` |
| `llmSummaryMaxInputTokens` | number | `16000` | Input ceiling for the exported engine |
| `replaceBasicCompaction` | boolean | `true` in `aggressive` | Logs a warning only; providers are chosen in `cordis.yml` |
| `includeToolNames` | string[] | `[]` | When non-empty, trim only these tools |
| `excludeToolNames` | string[] | `[]` | Never trim these tools |
| `cacheStableSections` | string[] | `[]` | Retained for API compatibility; the helper is exported but not applied |
| `telemetry` | object | absent | Optional fold, compaction, and local-response hooks |
| `rtkEnabled` | boolean | `false` | Enables the RTK structured-output pass |
| `cavemanLevel` | level | `off` | Caveman prompt style |
| `ponytailLevel` | level | `off` | Ponytail prompt style |
| `localResponsesEnabled` | boolean | `false` | Enables local probe answers |
| `localResponses` | kinds[] | all five | Which local probes may answer |

Caveman levels: `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan`,
`wenyan-ultra`. Ponytail levels: `off`, `lite`, `full`, `ultra`. Local kinds:
`quota`, `prefix`, `title`, `suggestion`, `filepath`.

Numbers must be finite and non-negative. Enums, booleans, strings, and string
arrays are checked by the `~standard` validator. An invalid value fails the
plugin load rather than silently falling back.

## Modes

| Mode | Tool-output trimming | Pressure handling | Notes |
|---|---|---|---|
| `off` | No | No | Disables tool-output compaction, including RTK |
| `conservative` | Yes | No | Default; returns before the pressure check |
| `balanced` | Yes | Yes | Pressure thresholds apply |
| `aggressive` | Yes | Yes | Same trimming; `replaceBasicCompaction` defaults on and warns |

`mode` is the gate for the tool-output path. `shouldHandle` returns false for
`off` before any filter runs, so setting `rtkEnabled: true` with `mode: off` does
not compact anything. Turn the mode on and control individual passes with their
own switches.

## Example

```yaml
dsh-token-saver:
  mode: conservative
  headBytes: 16384
  tailBytes: 8192
  rtkEnabled: false
  cavemanLevel: off
  ponytailLevel: off
  localResponsesEnabled: false
  localResponses: [quota, prefix, title, suggestion, filepath]
```

## Settings API

The Web client talks to the Host through two JSON routes mounted under the
`/api/token-saver` prefix:

| Method and path | Purpose |
|---|---|
| `GET /api/token-saver` | Current token-saver state and savings |
| `POST /api/token-saver` | Patch `enabled`, `rtk`, or prompt levels |
| `GET /api/token-saver/local-optimize` | Current local-response switches |
| `POST /api/token-saver/local-optimize` | Patch local-response switches |

Requests are capped at 64 KiB. Invalid JSON or an invalid enum returns `400`
with `{ error }`. Successful writes return `{ ok: true, ... }` and take effect
on the next hook call.

## Runtime behavior

- The prompt section's text provider is re-evaluated on every assembly, so
  changing Caveman or Ponytail from the panel applies to the next model step.
- Tool-output settings are read from the live runtime state on every result.
- The master switch short-circuits every hook when off. Requests pass through
  untouched.
- Bundle-only options such as `headBytes` and `pressureThreshold` require a
  plugin reload, because the panel does not expose them.
