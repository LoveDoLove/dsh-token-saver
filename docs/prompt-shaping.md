# Prompt shaping

Prompt shaping changes how the model writes, not how much context it receives.
It contributes a section to the DSH system prompt. It does not truncate history
and does not rewrite the agent-loop request.

## Two styles

**Caveman** compresses the answer. Grammar and pleasantries are traded for output
tokens while technical substance stays exact.

**Ponytail** compresses the work. It applies a lazy-senior-developer policy:
YAGNI, the smallest change, the simplest code that works.

They are independent and can be enabled together. Their text is joined with a
blank line in the order Caveman then Ponytail.

## Levels

| Caveman | Behavior |
|---|---|
| `off` | No section text |
| `lite` | Full sentences, filler and hedging removed |
| `full` | Terse fragments, articles and pleasantries dropped |
| `ultra` | Telegraphic, maximum compression |
| `wenyan-lite` | Semi-classical register, technical terms in English |
| `wenyan` | Classical Chinese, 80-90% character reduction |
| `wenyan-ultra` | Extreme classical compression |

| Ponytail | Behavior |
|---|---|
| `off` | No section text |
| `lite` | Build what is asked, name the lazier alternative in one line |
| `full` | Enforce the ladder, shortest diff and explanation |
| `ultra` | YAGNI extremist, deletion before addition |

## Boundaries

Every level keeps the same safety rails:

- Code blocks, file paths, commands, errors, and URLs stay exact.
- Security warnings, irreversible-action confirmations, and multi-step ordered
  sequences are written normally.
- No invented abbreviations. Standard acronyms are fine; symbol names, API
  names, and error strings stay verbatim.
- The user's dominant language is preserved, except for the Wenyan levels.
- The style is never announced. No "caveman mode" and no status phrases.
- The behavior persists across turns.

The section text is literal. `interpolate: false` stops DSH from resolving
`{{...}}` sequences inside the prompt.

## How it is delivered

The plugin registers one section through the supported API:

```ts
ctx.systemPrompt.section({
  name: 'token-saver:prompt-shaping',
  order: 9500,
  interpolate: false,
  text: () => buildActivePromptText(),
})
```

Order `9500` places it after the harness identity and tool guidance and before
the final structured-output section. The text provider is a function, so the
current levels are read on every assembly. A change in the Web panel applies to
the next model step without reloading the plugin.

The plugin does not listen to `system-prompt/assemble`. DSH builds the prompt
from ordered sections, and a registered section is the supported contribution
path. The waterfall is for inspection and replacement of the whole presentation,
not for adding text.

## Counting

A shaped prompt saves no bytes at the moment it is injected, so it has its own
counter. Each model step whose system prompt carries non-empty shaping text
increments `promptCalls` in the persisted totals. Byte savings and prompt
injections stay separate in the dashboard.

## Interaction with other plugins

`Our Free Model` recognizes the `<!-- ofm-token-saver -->` marker and skips its
own shaping, so the two do not stack. If another plugin already adds a shaping
section, the two sections both appear; disable one of them rather than relying on
ordering to resolve the conflict.
