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

### Measured (verified, in-process, conservative mode, v1.0.2)

| Scenario | Before | After | Saved |
|---|---:|---:|---:|
| Read-like tool output (head + tail) | 182,892 B | 24,675 B | 158,217 B (86.5%) |
| Grep-like output, production path | 19,781 B | 19,781 B | 0 B (0.0%) |
| Grep folding with a supplied pattern | 19,781 B | 1,301 B | 18,480 B (93.4%) |
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

I'd like feedback on whether the grep path should accept a search pattern at the
call site, since that's what unlocks the 93.4% figure. If that's not the right
direction, I'd rather know before shipping it.
