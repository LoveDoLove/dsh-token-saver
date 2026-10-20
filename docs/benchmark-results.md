# Benchmark results

This document records verified measurements of DSH Token Saver's compaction paths.
Measurements were produced following [docs/benchmark-methodology.md](benchmark-methodology.md).
All figures are UTF-8 byte reductions of text passing through the compaction
functions. They are **not** model token counts, token-cost savings, or task-quality
results.

## Build and environment

- Plugin version: 1.0.2
- Commit: `95b66ea4c660a7f1be047fba91bfad0777958cff`
- DSH version: 0.2.1-rc.2
- Node.js: v24.22.0
- OS: Linux 6.18.33.2-microsoft-standard-WSL2 (WSL2)
- Working tree: clean
- Benchmark script: `bench-tmp.ts` (committed for reproducibility)

## Configuration

- Mode: `conservative`
- `rtkEnabled`: `false`
- `cavemanLevel`: `off`
- `ponytailLevel`: `off`
- `localResponsesEnabled`: `false`
- Tool-output trim (from `resolveConfig` defaults): `headBytes = 16384`, `tailBytes = 8192`, `preserveStructure = true`
- Grep folding (defaults): `grepMaxMatches = 30`, `grepContextLines = 2`, `grepHeadBytes = 8192`, `grepTailBytes = 4096`, `foldNonMatching = true`
- RTK (scenario C only, invoked directly): `compressText` with filter `build-output`

## Workloads and scenarios

Each scenario is a deterministic, in-process call. No DSH session or LLM request was involved.

- **Scenario A — tool-output trimming (head + tail), production path.** A 2000-line
  synthetic file-read result (`line N: ` + 80 `x` characters), 182,892 bytes total.
  Exercised through `decidePostTool` in `src/strategies/tool-result-trim.ts` with
  tool name `read` (a `READ_LIKE_TOOLS` entry), so the production head/tail
  truncation path is taken. Unit-level simulation, not an end-to-end DSH session.
- **Scenario B-production — grep-like tool output through the production path.**
  A 500-line grep-style result where every line matches `match`, 19,781 bytes total.
  Exercised through `decidePostTool` with tool name `grep` (a `GREP_LIKE_TOOLS`
  entry). The production call site in `src/strategies/tool-result-trim.ts:164` does
  **not** pass a `pattern` to `foldGrepResult`, and `DEFAULTS.pattern` is `''`.
  Therefore `foldGrepResult` falls back to byte-based head/tail truncation and
  reports `matchCount: 0`, `truncatedMatches: 0`. This is the behavior the plugin
  ships in production today for this input shape.
- **Scenario B-library — direct `foldGrepResult` with a supplied pattern.** Same
  500-line input, but `foldGrepResult` is called directly with `pattern: 'match'`,
  exercising the match-retention, context-line, and match-truncation logic.
  This measures the library capability, not the production default behavior.
- **Scenario C — RTK build-output compaction.** A synthetic build log: 1
  deprecated-module warning, 200 repeated deprecated-package warnings, 50 TypeScript
  errors, and a failure summary, 9,423 bytes total. Exercised through `compressText`
  with the `build-output` filter. Unit-level simulation of the RTK filter path.

## Results

All three runs produced identical numbers.

### Scenario A (production path)

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction |
|---|---:|---:|---:|---:|
| 1 | 182,892 | 24,675 | 158,217 | 86.5% |
| 2 | 182,892 | 24,675 | 158,217 | 86.5% |
| 3 | 182,892 | 24,675 | 158,217 | 86.5% |
| Median | | | | 86.5% |

### Scenario B-production (production path, no pattern)

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction | matchCount | truncatedMatches |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 19,781 | 19,781 | 0 | 0.0% | 0 | 0 |
| 2 | 19,781 | 19,781 | 0 | 0.0% | 0 | 0 |
| 3 | 19,781 | 19,781 | 0 | 0.0% | 0 | 0 |
| Median | | | | 0.0% | 0 | 0 |

The input is below the `headBytes + tailBytes + 256` threshold for this path, so
no compaction is applied. This is the behavior the plugin ships today.

### Scenario B-library (direct `foldGrepResult`, pattern supplied)

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction | matchCount | truncatedMatches |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 19,781 | 1,301 | 18,480 | 93.4% | 30 | 470 |
| 2 | 19,781 | 1,301 | 18,480 | 93.4% | 30 | 470 |
| 3 | 19,781 | 1,301 | 18,480 | 93.4% | 30 | 470 |
| Median | | | | 93.4% | 30 | 470 |

This measures the folding library capability when a pattern is available. It is
**not** the production default behavior.

### Scenario C (RTK build-output filter)

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction | filter | compressed |
|---|---:|---:|---:|---:|---|---|
| 1 | 9,423 | 2,163 | 7,260 | 77.0% | build-output | true |
| 2 | 9,423 | 2,163 | 7,260 | 77.0% | build-output | true |
| 3 | 9,423 | 2,163 | 7,260 | 77.0% | build-output | true |
| Median | | | | 77.0% | | |

## Limitations

- These are byte reductions of text passing through the compaction functions, not
  model token counts. Byte counts do not convert one-to-one into tokens or billing.
- Scenarios A and C are unit-level simulations of the compaction functions, not
  end-to-end DSH session measurements. Scenario B-production reflects the actual
  production code path but with synthetic input; Scenario B-library measures
  library capability only.
- No task-quality, latency, or generalization claims are made. Byte reduction says
  nothing about whether the model still had the information it needed.
- A ratio measured on one workload does not transfer to another.
- In production today, grep-like tool output does not pass a search pattern to
  `foldGrepResult`, so the B-library figure is not realized by default.

## Reproduction

Run with Node.js and `tsx` from the repository root on a clean tree:

```bash
npx tsx bench-tmp.ts
```

with `bench-tmp.ts` containing:

```ts
import { resolveConfig } from './src/config.ts';
import { decidePostTool, shouldHandle } from './src/strategies/tool-result-trim.ts';
import { foldGrepResult } from './src/lib/fold-grep.ts';
import { compressText, createRtkStats } from './src/rtk/index.ts';

const cfg = resolveConfig({ mode: 'conservative' });

// Scenario A: production path, read-like tool output
const bigRead = Array.from({length: 2000}, (_, i) => 'line ' + (i+1) + ': ' + 'x'.repeat(80)).join('\n');
const beforeA = Buffer.byteLength(bigRead, 'utf8');
const resA = shouldHandle('read', cfg) ? decidePostTool(
  { exec: { name: 'read' }, result: { content: [{ type: 'text', text: bigRead }] } },
  { config: cfg }) : null;
const afterA = resA ? resA.trimmedBytes : beforeA;

// Scenario B-production: grep-like tool output through production path (no pattern)
const grepLines = [];
for (let i=0;i<500;i++) grepLines.push('/src/foo.ts:' + (i+1) + ': match ' + i + ' with context');
const grepInput = grepLines.join('\n');
const beforeB = Buffer.byteLength(grepInput,'utf8');
const resBProd = shouldHandle('grep', cfg) ? decidePostTool(
  { exec: { name: 'grep' }, result: { content: [{ type: 'text', text: grepInput }] } },
  { config: cfg }) : null;
const afterBProd = resBProd ? resBProd.trimmedBytes : beforeB;

// Scenario B-library: direct foldGrepResult WITH a pattern
const resBSynth = foldGrepResult(grepInput, { pattern: 'match', grepMaxMatches: cfg.grepMaxMatches, grepContextLines: cfg.grepContextLines, grepHeadBytes: cfg.grepHeadBytes, grepTailBytes: cfg.grepTailBytes });
const afterBSynth = resBSynth.trimmedBytes;

// Scenario C: RTK build output compaction
const buildLines = [];
buildLines.push('npm warn deprecated inflight@1.0.6: This module is not supported');
for (let i=0;i<200;i++) buildLines.push('npm warn deprecated pkg' + i + '@1.0.0: old');
for (let i=0;i<50;i++) buildLines.push('error TS2304: Cannot find name foo' + i);
buildLines.push('Build failed with 50 errors.');
const buildInput = buildLines.join('\n');
const beforeC = Buffer.byteLength(buildInput,'utf8');
const stats = createRtkStats();
const resC = compressText(buildInput, stats, 'build-output');
const afterC = resC.compressed ? Buffer.byteLength(resC.text, 'utf8') : beforeC;

function ratio(b:number,a:number){ return b>0 ? ((1-a/b)*100).toFixed(1) : '0.0'; }
console.log(JSON.stringify({
  env: { node: process.version, os: process.platform, mode: cfg.mode, rtkEnabled: cfg.rtkEnabled },
  A: { path: 'decidePostTool(read)', before: beforeA, after: afterA, saved: beforeA-afterA, ratio: ratio(beforeA,afterA), folded: resA?.folded ?? false },
  Bprod: { path: 'decidePostTool(grep)', before: beforeB, after: afterBProd, saved: beforeB-afterBProd, ratio: ratio(beforeB,afterBProd), folded: resBProd?.folded ?? false },
  Bsynth: { path: 'foldGrepResult(pattern=match)', before: beforeB, after: afterBSynth, saved: beforeB-afterBSynth, ratio: ratio(beforeB,afterBSynth), folded: resBSynth.folded, matchCount: resBSynth.matchCount, truncatedMatches: resBSynth.truncatedMatches },
  C: { path: 'compressText(build-output)', before: beforeC, after: afterC, saved: beforeC-afterC, ratio: ratio(beforeC,afterC), compressed: resC.compressed, filter: resC.filterUsed },
}, null, 2));
```
EOF
echo written