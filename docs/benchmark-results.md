# Benchmark results

This document records verified measurements of DSH Token Saver's compaction paths.
Measurements were produced following [docs/benchmark-methodology.md](benchmark-methodology.md).
All figures are UTF-8 byte reductions of text passing through the compaction
functions. They are **not** model token counts, token-cost savings, or task-quality
results.

## Build and environment

- Plugin version: 1.0.4
- Grep-folding fix commit: `8562f48234cf16b2261ccb3e63f6c5c233545b00`
  (`feat(tool-result-trim): read grep pattern from exec.arguments in production path`).
  Scenario A and C tables below were measured on the earlier doc commit
  `d7aa522`; scenario B was re-measured after the fix on identical code and
  environment, and its tables are current as of `8562f48`.
- The `src/` tree is unchanged since the measured commits except for the
  grep-folding fix, which touches only the grep path and therefore does not
  affect scenarios A and C.
- Since `8562f48`, v1.0.4 changed only `src/index.ts`, `src/local-responses/*`,
  and `src/prompt-shaping/*` (DSH contract-compatibility fixes). The measured
  paths — `src/config.ts`, `src/strategies/`, `src/lib/`, `src/rtk/` — are
  byte-identical, so the tables below still describe the v1.0.4 code path.
  The reproducible rows were re-run on v1.0.4 and matched the recorded values.
- DSH version: 0.2.1-rc.2
- Node.js: v24.22.0
- OS: Linux 6.18.33.2-microsoft-standard-WSL2 (WSL2)
- Working tree: clean
- Benchmark script: `bench-tmp.ts` (committed for reproducibility). It covers
  scenarios A, B-library, and C. The B-production input (29,321 bytes) is not
  reproduced by the committed script — see
  [Reproducibility status](#reproducibility-status).

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
  A 400-line grep-style result where every 20th line matches `needle`, 29,321
  bytes total — above the `headBytes + tailBytes + 256` threshold (24,832
  bytes), so the folding path actually fires. Exercised through
  `decidePostTool` with tool name `grep` (a `GREP_LIKE_TOOLS` entry) in two
  variants on identical input:
  - **B-prod-pattern** (`exec: { name: 'grep', arguments: { pattern: 'needle' } }`):
    matches the fixed behavior at commit `8562f48`, where
    `grepPattern(payload.exec?.arguments)` reads the search pattern and
    `foldGrepResult` folds non-matching lines, keeps matches plus context, and
    reports match truncation.
  - **B-prod-nopattern** (`exec: { name: 'grep' }` with no `arguments`):
    fail-open check. The fix changes only pattern extraction, so this run
    exercises the same code path plugin v1.0.2 shipped before the fix
    (byte-based head/tail truncation). It is the honest pre/post comparison
    for this input: the pre-fix doc table at 19,781 bytes reported 0.0%
    because that input was below the threshold and no compaction was applied
    at all — an input-size difference, not a code difference.
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

### Scenario B-production (production path, re-measured after commit `8562f48`)

Identical 400-line, 29,321-byte input in both variants; three runs each,
all identical.

**B-prod-pattern** — pattern supplied via `exec.arguments` (fixed behavior):

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction | folded |
|---|---:|---:|---:|---:|---|
| 1 | 29,321 | 8,145 | 21,176 | 72.2% | true |
| 2 | 29,321 | 8,145 | 21,176 | 72.2% | true |
| 3 | 29,321 | 8,145 | 21,176 | 72.2% | true |
| Median | | | | 72.2% | |

**B-prod-nopattern** — no `arguments` passed (fail-open check; same code path
as the pre-fix plugin behavior on this input):

| Run | Before (bytes) | After (bytes) | Saved (bytes) | Reduction | folded |
|---|---:|---:|---:|---:|---|
| 1 | 29,321 | 12,321 | 17,000 | 58.0% | true |
| 2 | 29,321 | 12,321 | 17,000 | 58.0% | true |
| 3 | 29,321 | 12,321 | 17,000 | 58.0% | true |
| Median | | | | 58.0% | |

Comparison notes:

- The earlier published B-production table (19,781 bytes, 0.0% reduction) used
  a **different, below-threshold input**, where no compaction fires at all. Its
  0.0% is an input-size artifact, not a code result; it must not be compared
  directly with the numbers above.
- On the same above-threshold input, pattern folding reduces output further
  than fail-open truncation (8,145 vs 12,321 bytes). The difference in these
  ratios (72.2% vs 58.0%) comes from input composition (match density,
  line length), not from a general claim about any other workload.

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
- In production, grep-like tool output now extracts the search pattern from
  `exec.arguments` (commit `8562f48`). The B-prod-pattern table above reflects
  this fixed behavior. The B-prod-nopattern table is the fail-open check and
  reproduces the pre-fix output on identical input. The B-library table remains
  library capability only, not a default-behavior claim.

## Reproduction

Run with Node.js and `tsx` from the repository root on a clean tree:

```bash
npx tsx bench-tmp.ts
```

### Reproducibility status

- Scenario A, scenario B-library, and scenario C are reproducible with the
  committed `bench-tmp.ts`: 182,892 → 24,675 bytes (86.5%), 19,781 → 1,301
  bytes (93.4%, `matchCount` 30, `truncatedMatches` 470), and 9,423 → 2,163
  bytes (77.0%).
- The **B-production** rows in the Results section were measured on a
  400-line, 29,321-byte grep-like input that is **not** reproduced by the
  committed script and whose generator is not committed to this repository.
  The committed script builds a 500-line, 19,781-byte input instead, which is
  below the `headBytes + tailBytes + 256` threshold (24,832 bytes), so the
  production path folds nothing on it (0.0% reduction, `folded: false`).
  The 29,321-byte figures are therefore historical measurements that cannot be
  re-run from this repository as committed; treat them as unverified
  reproduction-wise until the generator is restored.
- The script reproduced by the command above is:

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