# DSH Token Saver: A Whitepaper

## Abstract

DSH Token Saver is a plugin for DeepSeek Harness that reduces the text a model
must read without changing what the model can do. It compacts tool output at the
point where the Host hands results back to the agent, folds repetitive search
results, applies optional prompt-shaping text as a system-prompt section, and
answers a small set of well-identified requests locally. Tool-output trimming is
on in the default `conservative` mode; every additional optimization is off by
default, every optimization is reversible by configuration, and every
optimization fails open.

This paper explains why the plugin exists, the design principles behind it, how
it is built on DSH's extension points, and where it can go next. It is a design
document, not a feature list. The feature list lives in the
[README](../README.md).

## 1. The problem

An agent's context window is its working memory. It is filled by the system
prompt, the conversation, and, increasingly, by tool output. A single
`git diff`, `find`, test log, or grep over a large tree can consume more context
than the actual task needs. The model then has less room to reason, and the
harness has to compact sooner.

Most of that text is not useless. It is merely oversized. A diff has a few
hundred relevant lines and thousands of unchanged ones. A grep has thirty
matches and forty thousand lines of context. A build log has one error and ten
thousand lines of progress output.

The naive fix is to truncate everything. That is unsafe: truncation can delete
the one line that mattered, and it can delete the marker that tells a downstream
tool the content is incomplete. A better fix is to compact at the seam where
the Host knows both the tool identity and the result shape, apply a
shape-appropriate strategy, and keep the original content reachable through a
marker.

## 2. Vision

Make context efficiency a property of the harness, not a habit of the user.

The plugin should be:

- **Invisible when off.** A default install changes no model-facing behavior.
- **Predictable when on.** The same input and configuration produce the same
  output.
- **Safe under failure.** A bug in compaction must never break a request.
- **Honest in reporting.** Savings are measured in bytes, and the plugin says so.
- **Composable.** It cooperates with other plugins instead of owning the request
  pipeline.

## 3. Design philosophy

### 3.1 Compact the seam, not the request

DSH exposes a post-execute decision for tool results. That seam has the tool
name, the arguments, the result, and a `next()` that returns the final decision.
It is the right place to compact: the plugin sees what the model will see, and it
can decline without side effects. The plugin does not rewrite the assembled
prompt or the LLM request.

### 3.2 Only tool output

The plugin compacts tool results. It does not touch user messages, assistant
messages, system prompts (except through the supported prompt-section API), or
structured tool values. Tool output is where the volume is and where lossy
compression is defensible.

### 3.3 Never compact an error

An error result is diagnostic evidence. Trimming it risks hiding the failure.
The plugin returns errors unchanged.

### 3.4 Strictly smaller or unchanged

A compaction result is accepted only when it is non-empty and strictly smaller
than the original. A filter that cannot improve the text returns the original.

### 3.5 Fail open

Every strategy is wrapped. A detector error, a regex error, a malformed result,
or a telemetry write failure returns the upstream decision. The request path
never throws because of the plugin.

### 3.6 Configuration is explicit

The default `conservative` mode trims and folds oversized tool output. Every
additional behavior that changes model input — RTK, prompt shaping, local
responses, pressure compaction — is opt-in. Invalid values fail activation
instead of being silently coerced.

### 3.7 Measure bytes, not tokens

The plugin can count UTF-8 bytes exactly. It cannot count model tokens exactly,
because tokenization depends on the model and the provider. Reporting bytes as
tokens would be a lie that compounds across a dashboard. The plugin reports
bytes and says so.

## 4. System architecture

### 4.1 Layers

```
DSH Host
  ├── tools/post-execute ──> compaction pipeline ──> truncation / grep fold / RTK
  ├── agent/pre-step ──────> pressure check ───────> compaction engine (side effect)
  ├── systemPrompt.section > Caveman / Ponytail text
  └── llm/stream ──────────> local response stream (read-only otherwise)
```

The plugin has four entry points and one shared state object. The entry points
are independent: disabling one does not disable the others.

### 4.2 The compaction pipeline

`decidePostTool` is a pure function of the execution, the result, and the
configuration. It applies, in order:

1. eligibility checks (mode, include/exclude lists, error, value-only results);
2. RTK filtering when enabled, with an autodetect guard for read-like tools;
3. grep folding for search-like tools;
4. byte-budget truncation for everything else.

The decision is merged with the upstream decision only when the upstream
decision is a plain accept. A block or a structured value wins.

### 4.3 Prompt shaping

Prompt shaping is a system-prompt section named `token-saver:prompt-shaping` at
order 9500, with `interpolate: false`. Its text provider reads the live level
settings, so a change applies on the next assembly without re-registering the
section. When both levels are off, the section contributes an empty string.

This follows the documented DSH rule: add prompt text with
`ctx.systemPrompt.section()`, not by listening to `system-prompt/assemble`.

### 4.4 Local responses

Some requests do not need a model at all: a quota probe, a prefix extraction, a
session title, a suggestion probe, a filepath extraction. The plugin recognizes
a narrow set of shapes and answers them with a synthetic stream whose usage is
zero. Recognition requires positive evidence, such as a `Command:`/`Output:`
pair or a `[SUGGESTION MODE:` marker; a single keyword is not enough.

### 4.5 Pressure

The pre-step hook reads the token meter and compares pressure against two
thresholds. Above the second threshold, it asks the compaction engine to compact
as a side effect. It never rewrites the step's messages.

### 4.6 State

Two small JSON files under `$DSH_HOME/token-saver/`: `settings.json` for live
overrides written by the Web panel, and `stats.json` for cumulative byte
counters. Both are read fail-open. The plugin keeps no database and no
background process.

## 5. Core concepts

**Tool result compaction.** Replacing a tool result's text with a smaller text
that preserves the parts a reader needs.

**Truncation.** Keeping a head and a tail within a byte budget, optionally at
line boundaries, with an explicit omission marker.

**Grep folding.** Keeping matching lines plus surrounding context, with markers
for omitted gaps and truncated matches.

**RTK filters.** Shape-aware compactors for diffs, status, logs, trees, tables,
and build output. They are lossy and marker-based.

**Prompt shaping.** Caveman and Ponytail text that asks the model to answer
tersely while preserving exact code, paths, commands, errors, and URLs.

**Local response.** A synthetic model stream produced without a model call.

**Savings.** The difference between the original and compacted byte counts,
accumulated only when the compacted text reaches the model.

## 6. Technical design decisions

### 6.1 Post-execute instead of prompt assembly

Compacting at `tools/post-execute` preserves the model's view of the tool
result and avoids rewriting the frozen LLM request. The agent-loop request is a
pure function of the session log and is deep-frozen; mutating it is both
unsupported and unstable.

### 6.2 One export form

The package exports `name`, `Config`, `inject`, and `apply`. It does not also
export a default object. DSH's plugin loader accepts one form, and mixing forms
makes the load path ambiguous.

### 6.3 Standard Schema configuration

`Config` exposes `~standard`, so DSH validates row configuration at activation
and rejects invalid values. `resolveConfig` remains available for programmatic
callers that want tolerant defaults, but the Host path is strict.

### 6.4 Per-call accounting

Each tool invocation creates its own accumulator. The accumulator is merged
into the shared totals once, and only when the compacted result is actually
returned. This prevents double counting and keeps `calls` and `blocks` honest.

### 6.5 Multi-block rebuild

When a result has several text blocks, the compacted text is split across them
in proportion to their original UTF-8 byte shares. This keeps block boundaries
meaningful and avoids collapsing a multi-block result into one block.

### 6.6 Two configuration layers

Cordis row configuration is the durable layer. The Web panel writes live
overrides to `settings.json`. The panel is a convenience, not a second source of
truth for deployment.

### 6.7 No runtime provider replacement

DSH selects compaction providers through `cordis.yml`. The plugin does not
mutate the service registry at runtime. `replaceBasicCompaction` therefore logs a
warning and changes nothing. The LLM-summary engine remains exported for hosts
that wire it as a provider.

## 7. What the plugin deliberately does not do

- It does not summarize the conversation.
- It does not change the model, temperature, or routing.
- It does not rewrite the system prompt through the assembly waterfall.
- It does not mutate the LLM request.
- It does not replace compaction providers.
- It does not store prompts or tool output on disk.
- It does not claim token counts it cannot measure.

## 8. Evaluation

The benchmark measures UTF-8 byte reduction on synthetic tool output for five
shapes: a large diff, a grep result, a find result, a build log, and a table.
Results range from 58% to 93% reduction. The methodology is documented in
[benchmark-methodology](benchmark-methodology.md), and the raw table is in
[benchmark-results](benchmark-results.md).

The numbers are a property of the fixtures, not a promise about a real
repository. The correct reading is: for these shapes, the strategies remove most
of the bytes while keeping the informative parts.

## 9. Future direction

- **Provider integration.** Wire the exported LLM-summary engine into a
  documented compaction provider instead of leaving it as an export.
- **Token-aware budgets.** Accept a tokenizer callback so budgets can be
  expressed in tokens when a host provides one, while keeping bytes as the
  fallback.
- **Adaptive thresholds.** Learn per-tool budgets from observed result sizes
  instead of fixed byte counts.
- **Better markers.** Standardize the omission marker so other tools can detect
  and expand compacted content.
- **Local response coverage.** Add probes only when they can be recognized
  without ambiguity. Coverage is not a goal by itself.
- **Cross-plugin cooperation.** Publish a small interface that other plugins can
  use to declare "do not compact my output" or "this result is already
  compacted."

## 10. Conclusion

Token Saver is a small plugin with a narrow claim: tool output is where context
is wasted, and a careful, opt-in, fail-open compactor at the tool seam can
recover most of it without changing the model's capabilities. The design follows
DSH's supported extension points, keeps the frozen request frozen, and reports
what it actually measured.
