# Reddit draft (not published)

**Subreddit:** r/LocalLLM or r/LLM (post under the thread's rules; no self-promotion
without disclosure)

## Title

Open-sourced DSH Token Saver: trims oversized tool output to save context tokens

## Body

I built a small plugin for DeepSeek Harness (DSH) that trims the large tool
results that eat up most of a session's context before the model ever needs all
of it: file reads, grep dumps, command logs.

It runs three compaction paths:

- **Tool-output trimming** keeps the head and tail of oversized results and drops
  the middle.
- **Grep folding** folds large grep results while retaining context.
- **RTK compaction** rewrites structured command output through a filter.

Everything is configurable and disabled or conservative by default where
appropriate.

### Measured (verified, in-process, conservative mode, v1.0.4)

| Scenario | Before | After | Saved |
|---|---:|---:|---:|
| Read-like tool output (head + tail) | 182,892 B | 24,675 B | 158,217 B (86.5%) |
| Grep-like output, production path (pattern supplied) | 29,321 B | 8,145 B | 21,176 B (72.2%) |
| Grep-like output, production path (no pattern — fail-open) | 29,321 B | 12,321 B | 17,000 B (58.0%) |
| Grep folding with a supplied pattern (library capability) | 19,781 B | 1,301 B | 18,480 B (93.4%) |
| RTK build-output compaction | 9,423 B | 2,163 B | 7,260 B (77.0%) |

These are UTF-8 byte reductions of synthetic input passed through the compaction
functions in-process. They are not model token counts, token-cost savings, or
task-quality evidence. The grep path in production today does not receive a
search pattern, so the 93.4% figure is the library's capability, not the
default behavior. Full methodology and reproducible commands are in
`docs/benchmark-results.md`.

### Install

```
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

### Limitations

- Byte reduction is not token reduction, and token reduction is not billing
  savings.
- These are unit-level simulations of the compaction functions, not end-to-end
  DSH session measurements.
- No task-quality, latency, or generalization claims are made.

### Why I'm posting

The grep path now reads the search pattern from `exec.arguments` (commit
`8562f48`); the 72.2% row reflects that. I'd like feedback on whether
requiring the pattern at the call site is the right direction, or whether
falling back to head/tail truncation when it is absent (current behavior)
is preferable.
