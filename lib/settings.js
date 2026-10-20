import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function resolveDshHome() {
    const fromEnv = process.env.DSH_HOME;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '')
        return fromEnv.trim();
    return path.join(os.homedir(), '.dsh');
}
export const CAVEMAN_LEVELS = [
    'off',
    'lite',
    'full',
    'ultra',
    'wenyan-lite',
    'wenyan',
    'wenyan-ultra',
];
export const PONYTAIL_LEVELS = ['off', 'lite', 'full', 'ultra'];
export function getLiveSavings(rtkStats, totals) {
    // Persisted totals are the source of truth when bound; the accumulator is
    // the fallback for callers that only hold this process's `RtkStats`.
    const orig = totals ? totals.bytesBefore : (rtkStats?.bytesBefore ?? 0);
    const comp = totals ? totals.bytesAfter : (rtkStats?.bytesAfter ?? 0);
    const saved = totals ? Math.max(0, totals.saved) : (rtkStats?.saved ?? Math.max(0, orig - comp));
    const percent = orig > 0 ? Math.round((saved / orig) * 100) : 0;
    // `blocks` counts compressed text blocks, `calls` counts invocations that
    // produced at least one. The accumulator has no call boundary, so its
    // fallback mirrors hits.
    const blocks = totals ? Math.max(0, totals.blocks) : (rtkStats?.hits?.length ?? 0);
    const calls = totals ? Math.max(0, totals.calls) : (rtkStats?.hits?.length ?? 0);
    const promptCalls = 0;
    const summary = calls > 0
        ? `${calls} calls · ${percent}% (${(saved / 1024).toFixed(1)} KB) saved`
        : '';
    return {
        bytesBefore: orig,
        bytesAfter: comp,
        saved,
        percent: Math.max(0, Math.min(100, percent)),
        blocks,
        calls,
        promptCalls,
        summary,
    };
}
export class SettingsManager {
    filePath;
    constructor(customPath) {
        this.filePath = customPath ?? path.join(resolveDshHome(), 'token-saver', 'settings.json');
    }
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                return JSON.parse(raw);
            }
        }
        catch {
            // Fallback open on read failure
        }
        return {};
    }
    save(settings) {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf8');
        }
        catch {
            // Fail open on write failure
        }
    }
    init(initialConfig, rtkStats, totals) {
        const stored = this.load();
        let enabled = true;
        if (typeof stored.enabled === 'boolean') {
            enabled = stored.enabled;
        }
        let rtkEnabled = initialConfig.rtkEnabled;
        if (typeof stored.rtk === 'boolean') {
            rtkEnabled = stored.rtk;
        }
        let cavemanLevel = initialConfig.cavemanLevel;
        if (stored.prompts?.caveman && CAVEMAN_LEVELS.includes(stored.prompts.caveman)) {
            cavemanLevel = stored.prompts.caveman;
        }
        let ponytailLevel = initialConfig.ponytailLevel;
        if (stored.prompts?.ponytail && PONYTAIL_LEVELS.includes(stored.prompts.ponytail)) {
            ponytailLevel = stored.prompts.ponytail;
        }
        let localResponsesEnabled = initialConfig.localResponsesEnabled;
        if (typeof stored.local?.enabled === 'boolean') {
            localResponsesEnabled = stored.local.enabled;
        }
        const localResponses = new Set(initialConfig.localResponses);
        if (stored.local) {
            if (stored.local.quota !== undefined) {
                if (stored.local.quota)
                    localResponses.add('quota');
                else
                    localResponses.delete('quota');
            }
            if (stored.local.prefix !== undefined) {
                if (stored.local.prefix)
                    localResponses.add('prefix');
                else
                    localResponses.delete('prefix');
            }
            if (stored.local.title !== undefined) {
                if (stored.local.title)
                    localResponses.add('title');
                else
                    localResponses.delete('title');
            }
            if (stored.local.suggestion !== undefined) {
                if (stored.local.suggestion)
                    localResponses.add('suggestion');
                else
                    localResponses.delete('suggestion');
            }
            if (stored.local.filepath !== undefined) {
                if (stored.local.filepath)
                    localResponses.add('filepath');
                else
                    localResponses.delete('filepath');
            }
        }
        const mergedConfig = {
            ...initialConfig,
            rtkEnabled,
            cavemanLevel,
            ponytailLevel,
            localResponsesEnabled,
            localResponses,
        };
        return {
            enabled,
            config: mergedConfig,
            rtkStats,
            totals,
        };
    }
    getPublicTokenSaver(state) {
        return {
            enabled: state.enabled,
            rtk: state.config.rtkEnabled,
            prompts: {
                caveman: state.config.cavemanLevel,
                ponytail: state.config.ponytailLevel,
            },
            cavemanLevels: CAVEMAN_LEVELS,
            ponytailLevels: PONYTAIL_LEVELS,
            savings: getLiveSavings(state.rtkStats, state.totals?.()),
        };
    }
    getPublicLocalOptimize(state) {
        return {
            enabled: state.config.localResponsesEnabled,
            quota: state.config.localResponses.has('quota'),
            prefix: state.config.localResponses.has('prefix'),
            title: state.config.localResponses.has('title'),
            suggestion: state.config.localResponses.has('suggestion'),
            filepath: state.config.localResponses.has('filepath'),
        };
    }
    updateTokenSaver(state, patch) {
        if (!patch || typeof patch !== 'object') {
            throw new Error('Patch must be an object');
        }
        const rec = patch;
        const stored = this.load();
        if (typeof rec.enabled === 'boolean') {
            state.enabled = rec.enabled;
            stored.enabled = rec.enabled;
        }
        if (typeof rec.rtk === 'boolean') {
            state.config = { ...state.config, rtkEnabled: rec.rtk };
            stored.rtk = rec.rtk;
        }
        if (rec.prompts && typeof rec.prompts === 'object') {
            const prompts = rec.prompts;
            stored.prompts = stored.prompts ?? {};
            if (prompts.caveman !== undefined) {
                const val = String(prompts.caveman);
                if (!CAVEMAN_LEVELS.includes(val)) {
                    throw new Error(`Invalid caveman level "${val}", expected one of: ${CAVEMAN_LEVELS.join(', ')}`);
                }
                state.config = { ...state.config, cavemanLevel: val };
                stored.prompts.caveman = val;
            }
            if (prompts.ponytail !== undefined) {
                const val = String(prompts.ponytail);
                if (!PONYTAIL_LEVELS.includes(val)) {
                    throw new Error(`Invalid ponytail level "${val}", expected one of: ${PONYTAIL_LEVELS.join(', ')}`);
                }
                state.config = { ...state.config, ponytailLevel: val };
                stored.prompts.ponytail = val;
            }
        }
        this.save(stored);
        return this.getPublicTokenSaver(state);
    }
    updateLocalOptimize(state, patch) {
        if (!patch || typeof patch !== 'object') {
            throw new Error('Patch must be an object');
        }
        const rec = patch;
        const stored = this.load();
        stored.local = stored.local ?? {};
        if (typeof rec.enabled === 'boolean') {
            state.config = { ...state.config, localResponsesEnabled: rec.enabled };
            stored.local.enabled = rec.enabled;
        }
        const localSet = new Set(state.config.localResponses);
        const kinds = ['quota', 'prefix', 'title', 'suggestion', 'filepath'];
        for (const kind of kinds) {
            if (typeof rec[kind] === 'boolean') {
                const val = rec[kind];
                if (val)
                    localSet.add(kind);
                else
                    localSet.delete(kind);
                stored.local[kind] = val;
            }
        }
        state.config = { ...state.config, localResponses: localSet };
        this.save(stored);
        return this.getPublicLocalOptimize(state);
    }
}
