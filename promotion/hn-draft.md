# Hacker News draft (not published)

## Title

Show HN: DSH Token Saver — trims oversized tool output to reclaim context

## Body

I built a plugin for DeepSeek Harness (DSH) that trims the large tool results
that consume most of a session's context before the model ever needs all of it:
file reads, grep dumps, command logs.

Paths:

- Tool-output trimming: keeps head and tail, drops the middle.
- Grep folding: folds large grep results while retaining context.
- RTK compaction: rewrites structured command output through a filter.

Configurable; disabled or conservative by default where appropriate.

### Verified measurements (v1.0.2, DSH 0.2.1-rc.2, Node v24.22.0, Linux, conservative
mode, RTK off)

| Scenario | Before | After | Saved |
|---|---:|---:|---:|
| Read-like tool output (head + tail) | 182,892 B | 24,675 B | 158,217 B (86.5%) |
| Grep-like output, production path | 19,781 B | 19,781 B | 0 B (0.0%) |
| Grep folding with a supplied pattern | 19,781 B | 1,301 B | 18,480 B (93.4%) |
| RTK build-output compaction | 9,423 B | 2,163 B | 7,260 B (77.0%) |

UTF-8 byte reductions of synthetic input through the compaction functions
in-process. Not model token counts, token-cost savings, latency, or
task-quality evidence. Full methodology and reproducible commands in
`docs/benchmark-results.md`.

Install:

```
dsh plugin --profile web add github:LoveDoLove/dsh-token-saver
```

### Limitations

- Byte reduction is not token reduction; token reduction is not billing savings.
- Unit-level simulations of the compaction functions, not end-to-end DSH session
  measurements.
- The grep path in production today does not receive a search pattern, so the
  93.4% figure is the library's capability, not the default behavior.

### Open question

Should the grep path accept a search pattern at the call site? That unlocks the
93.4% figure. Happy to change direction based on feedback.
