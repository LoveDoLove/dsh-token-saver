/**
 * Cumulative RTK savings telemetry, persisted separately from user settings.
 *
 * The in-memory `RtkStats` accumulator is per-process and per-session; this
 * store keeps the historical totals in ~/.dsh/token-saver/stats.json so the Web
 * dashboard still reports savings after a host restart.
 *
 * Callers hand in per-invocation stats (the shared accumulator is never
 * recorded directly), so each compression pass is counted exactly once. A pass
 * that compresses nothing records nothing. Because the same tool output can be
 * compacted twice — once by tools/post-execute and again by llm/stream on the
 * already-compacted text — `calls` counts compaction events, `blocks` counts
 * compacted text blocks, and `saved` stays exact since per-pass savings add up
 * to the total reduction. Every read and write is fail-open: broken telemetry
 * must never affect compression behaviour or throw into a request path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveDshHome } from './settings.js';
function toCounter(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function emptyTotals() {
    return {
        bytesBefore: 0,
        bytesAfter: 0,
        saved: 0,
        calls: 0,
        blocks: 0,
    };
}
export function resolveStatsPath() {
    return path.join(resolveDshHome(), 'token-saver', 'stats.json');
}
export class StatsStore {
    filePath;
    totals;
    constructor(customPath) {
        this.filePath = customPath ?? resolveStatsPath();
        this.totals = this.load();
    }
    getFilePath() {
        return this.filePath;
    }
    get() {
        return { ...this.totals };
    }
    /**
     * Fold one invocation's stats into the cumulative totals.
     *
     * `blocks` counts compressed text blocks while `calls` counts the
     * invocations that produced at least one of them: one request compacting
     * three blocks advances `calls` by one and `blocks` by three. An
     * invocation without a hit records nothing and never touches the file.
     */
    record(stats) {
        try {
            const blocks = Array.isArray(stats?.hits) ? stats.hits.length : 0;
            if (blocks <= 0)
                return this.get();
            this.totals = {
                bytesBefore: this.totals.bytesBefore + toCounter(stats?.bytesBefore),
                bytesAfter: this.totals.bytesAfter + toCounter(stats?.bytesAfter),
                saved: this.totals.saved + toCounter(stats?.saved),
                calls: this.totals.calls + 1,
                blocks: this.totals.blocks + blocks,
            };
            this.save();
        }
        catch {
            // Fail open: telemetry must never break a request path.
        }
        return this.get();
    }
    load() {
        try {
            if (!fs.existsSync(this.filePath))
                return emptyTotals();
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (parsed == null || typeof parsed !== 'object')
                return emptyTotals();
            return {
                bytesBefore: toCounter(parsed.bytesBefore),
                bytesAfter: toCounter(parsed.bytesAfter),
                saved: toCounter(parsed.saved),
                calls: toCounter(parsed.calls),
                blocks: toCounter(parsed.blocks),
            };
        }
        catch {
            // Fail open on read/parse failure: start from zero instead of crashing.
            return emptyTotals();
        }
    }
    save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.totals, null, 2), 'utf8');
        }
        catch {
            // Fail open on write failure; in-memory totals stay authoritative.
        }
    }
}
