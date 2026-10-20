import { resolveConfig } from './src/config.ts';
import { decidePostTool, shouldHandle } from './src/strategies/tool-result-trim.ts';
import { foldGrepResult } from './src/lib/fold-grep.ts';
import { compressText, createRtkStats } from './src/rtk/index.ts';

const cfg = resolveConfig({ mode: 'conservative' });

// Scenario A: large Read-like tool output (head+tail trim), production path
const bigRead = Array.from({length: 2000}, (_, i) => 'line ' + (i+1) + ': ' + 'x'.repeat(80)).join('\n');
const beforeA = Buffer.byteLength(bigRead, 'utf8');
const resA = shouldHandle('read', cfg) ? decidePostTool(
  { exec: { name: 'read' }, result: { content: [{ type: 'text', text: bigRead }] } },
  { config: cfg }) : null;
const afterA = resA ? resA.trimmedBytes : beforeA;

// Scenario B-prod: grep-like tool output through production path (no pattern passed by call site)
const grepLines = [];
for (let i=0;i<500;i++) grepLines.push('/src/foo.ts:' + (i+1) + ': match ' + i + ' with context');
const grepInput = grepLines.join('\n');
const beforeB = Buffer.byteLength(grepInput,'utf8');
const resBProd = shouldHandle('grep', cfg) ? decidePostTool(
  { exec: { name: 'grep' }, result: { content: [{ type: 'text', text: grepInput }] } },
  { config: cfg }) : null;
const afterBProd = resBProd ? resBProd.trimmedBytes : beforeB;

// Scenario B-synth: direct foldGrepResult WITH a pattern (library capability, not production default)
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
  Bprod: { path: 'decidePostTool(grep)', before: beforeB, after: afterBProd, saved: beforeB-afterBProd, ratio: ratio(beforeB,afterBProd), folded: resBProd?.folded ?? false, matchCount: 0, truncatedMatches: 0 },
  Bsynth: { path: 'foldGrepResult(pattern=match)', before: beforeB, after: afterBSynth, saved: beforeB-afterBSynth, ratio: ratio(beforeB,afterBSynth), folded: resBSynth.folded, matchCount: resBSynth.matchCount, truncatedMatches: resBSynth.truncatedMatches },
  C: { path: 'compressText(build-output)', before: beforeC, after: afterC, saved: beforeC-afterC, ratio: ratio(beforeC,afterC), compressed: resC.compressed, filter: resC.filterUsed },
}, null, 2));
