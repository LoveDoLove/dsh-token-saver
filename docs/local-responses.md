# Local responses

Some requests are not really questions for the model. They are probes the
harness sends to learn a small mechanical fact: whether a quota is available,
what a command is, what the session should be called. Answering those locally
removes a full round trip and its input tokens.

Local responses are opt-in (`localResponsesEnabled: true`) and can be limited per
kind. The plugin only answers exact probe shapes. A normal user message is never
swallowed.

## The five kinds

| Kind | Trigger | Answer |
|---|---|---|
| `quota` | A single user turn mentioning "quota" with a one-token budget | `Quota check passed.` |
| `prefix` | A single user turn containing `<policy_spec>` and `Command:` | The command prefix extracted after the last `Command:` |
| `title` | A title request with no tools | A short title derived from the first human message |
| `suggestion` | Any user message containing `[SUGGESTION MODE:` | Empty text |
| `filepath` | A command-and-output turn that asks for file paths | Paths extracted from the command and output |

Detectors run in that order and the first match wins.

## Why each trigger is narrow

The cost of a false positive is high: a real request answered locally never
reaches the model. Each detector therefore requires a shape that ordinary use
does not produce.

- **Quota** requires both the word "quota" and `maxTokens === 1`. A bare integer
  message is an ordinary message, not a probe.
- **Prefix** requires the policy envelope, not just the word "command".
- **Title** requires `purpose: 'session-title'` or a system prompt with the title
  provider's specific shape. It never returns a constant placeholder; if no title
  can be derived, the request goes to the model.
- **Suggestion** requires the literal `[SUGGESTION MODE:` marker.
- **Filepath** requires a command/output pair and either the user asking for
  "filepaths" or the system asking to extract paths from the command. The looser
  "file path" substring was removed because it matched ordinary requests.

## Synthetic stream

An answered request yields the canonical chunk sequence: `block-start`,
`text-delta`, `block-end`, `usage`, `finish` with `{ kind: 'stop' }`.

The `usage` chunk reports zero input and zero output tokens. That is the real
consumption of the turn, because no upstream model was called. Reporting the
avoided cost there would make the token meter count imaginary usage as real. The
nominal estimate is exposed through the telemetry hook instead, as
`promptTokensEstimate` and `savedTokensEstimate`.

## Configuration

```yaml
dsh-token-saver:
  localResponsesEnabled: true
  localResponses: [quota, prefix, title, suggestion, filepath]
```

Remove a kind from the list to leave those requests to the model. The Web panel
exposes the same switches.

## Failure behavior

The whole path is wrapped in a try/catch. A detector error logs a warning and
falls through to `next()`, so a broken probe never blocks a model call.
