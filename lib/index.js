import { resolveConfig, TokenSaverSchema, DEFAULTS } from './config.js';
import { decidePostTool } from './strategies/tool-result-trim.js';
import { decidePreStep } from './strategies/context-pressure.js';
import { stabilizeForCache } from './strategies/prompt-cache.js';
import { LlmSummaryCompactionEngine, DEFAULT_COMPACTION_PROMPT } from './strategies/llm-summary.js';
import { createRtkStats, compressMessages, mergeRtkStats } from './rtk/index.js';
import { SettingsManager } from './settings.js';
import { StatsStore } from './stats-store.js';
import { createApiRoutes } from './routes.js';
import { activePrompts, injectSystem, } from './prompt-shaping/index.js';
import { createAssembleInjector } from './prompt-shaping/assemble.js';
import { detectOptimization, createLocalResponseStream, localAnswerEstimate, } from './local-responses/index.js';
export const name = 'dsh-token-saver';
export const Config = TokenSaverSchema;
export const inject = ['tools'];
export async function apply(rawScope, rawConfig) {
    const scope = asScope(rawScope);
    if (!scope) {
        throw new Error('token-saver: invalid Cordis scope');
    }
    const resolved = resolveConfig(asTokenSaverConfig(rawConfig));
    const ownLogger = createDefaultLogger();
    ownLogger.info(`token-saver: mode=${resolved.mode} rtk=${resolved.rtkEnabled} caveman=${resolved.cavemanLevel} ponytail=${resolved.ponytailLevel} localResponses=${resolved.localResponsesEnabled}`);
    const tokenMeter = makeTokenMeterAccessor(scope);
    const compactionEngine = makeCompactionAccessor(scope);
    const agentForSession = makeAgentAccessor(scope);
    const callLlm = makeLlmCaller(resolved, ownLogger);
    const sessionEventsProvider = makeSessionEventsAccessor(scope);
    // Two views of the same figures: `rtkStats` accumulates this process's
    // compression, `statsStore` persists the historical totals across restarts.
    const rtkStats = createRtkStats();
    const statsStore = new StatsStore();
    const settingsManager = new SettingsManager();
    const runtimeState = settingsManager.init(resolved, rtkStats, () => statsStore.get());
    // Mount WebServer API routes if webServer service is available
    if (typeof scope.inject === 'function') {
        ;
        scope.inject(['webServer'], (scoped) => {
            const server = scoped.webServer;
            if (server && typeof server.register === 'function') {
                const apiHandler = createApiRoutes({
                    getSaver: () => settingsManager.getPublicTokenSaver(runtimeState),
                    setSaver: patch => settingsManager.updateTokenSaver(runtimeState, patch),
                    getLocal: () => settingsManager.getPublicLocalOptimize(runtimeState),
                    setLocal: patch => settingsManager.updateLocalOptimize(runtimeState, patch),
                });
                const unregister = server.register({
                    kind: 'prefix',
                    path: '/api/token-saver',
                    handler: apiHandler,
                });
                if (typeof unregister === 'function' && typeof scoped.effect === 'function') {
                    scoped.effect(() => () => unregister());
                }
                ownLogger.info('token-saver: web API mounted at /api/token-saver');
            }
        });
    }
    else if (scope.webServer) {
        const server = scope.webServer;
        if (server && typeof server.register === 'function') {
            const apiHandler = createApiRoutes({
                getSaver: () => settingsManager.getPublicTokenSaver(runtimeState),
                setSaver: patch => settingsManager.updateTokenSaver(runtimeState, patch),
                getLocal: () => settingsManager.getPublicLocalOptimize(runtimeState),
                setLocal: patch => settingsManager.updateLocalOptimize(runtimeState, patch),
            });
            server.register({
                kind: 'prefix',
                path: '/api/token-saver',
                handler: apiHandler,
            });
            ownLogger.info('token-saver: web API mounted at /api/token-saver');
        }
    }
    // 1) Tool result trimming + RTK filter hook
    const trimmedListener = (arg1, arg2, arg3) => {
        if (!runtimeState.enabled || (runtimeState.config.mode === 'off' && !runtimeState.config.rtkEnabled)) {
            if (typeof arg3 === 'function') {
                return arg3();
            }
            if (typeof arg2 === 'function') {
                return arg2();
            }
            return Promise.resolve({ kind: 'accept' });
        }
        // DSH waterfall event 'tools/post-execute' passes 3 arguments:
        // (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>)
        if (typeof arg3 === 'function') {
            const exec = arg1;
            const result = (arg2 ?? {});
            const next = arg3;
            return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore);
        }
        // Backward compatibility for 2-argument signature: ({ exec, result }, next)
        if (typeof arg2 === 'function') {
            const payload = arg1;
            const exec = payload?.exec ?? arg1;
            const result = (payload?.result ?? {});
            const next = arg2;
            return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore);
        }
        // Defensive fallback when invoked without next
        const exec = arg1;
        const result = (arg2 ?? {});
        const next = () => Promise.resolve({ kind: 'accept' });
        return handlePostTool(exec, result, next, runtimeState.config, runtimeState.rtkStats, statsStore);
    };
    // 2) Context pressure pre-step hook
    const preStepListener = (rawPayload, rawNext) => {
        const next = typeof rawNext === 'function'
            ? rawNext
            : () => Promise.resolve({ kind: 'enter' });
        if (!runtimeState.enabled) {
            return next();
        }
        return handlePreStep(rawPayload, next, runtimeState.config, {
            logger: ownLogger,
            telemetry: runtimeState.config.telemetry,
            getTokenMeter: tokenMeter,
            getCompactionEngine: compactionEngine,
            agentForSession,
        });
    };
    scope.on('tools/post-execute', trimmedListener);
    scope.on('agent/pre-step', preStepListener);
    // 2b) Prompt shaping through the DSH `system-prompt/assemble` waterfall.
    //
    // The `llm/stream` request is deep-frozen by the agent loop, so the system
    // prompt cannot be mutated there. DSH builds the model-facing system prompt
    // from ordered sections, and the `system-prompt/assemble` waterfall lets a
    // plugin contribute a section — the returned assembly is authoritative.
    //
    // The listener is registered unconditionally: it resolves the prompt text on
    // every assembly, so enabling or disabling Caveman/Ponytail at runtime takes
    // effect on the next model step without reloading the plugin.
    scope.on('system-prompt/assemble', createAssembleInjector(() => {
        if (!runtimeState.enabled)
            return '';
        const cfg = runtimeState.config;
        if (cfg.cavemanLevel === 'off' && cfg.ponytailLevel === 'off')
            return '';
        return activePrompts({
            caveman: cfg.cavemanLevel,
            ponytail: cfg.ponytailLevel,
        })
            .map((p) => p.text)
            .join('\n\n');
    }));
    // 3) Global LLM Stream hook: Local responses & Prompt shaping
    const llmStreamListener = function (options, next) {
        try {
            const req = options;
            if (!runtimeState.enabled) {
                return next();
            }
            const currentConfig = runtimeState.config;
            // A) Local responses (quota, prefix, title, suggestion, filepath)
            if (currentConfig.localResponsesEnabled && req) {
                const answer = detectOptimization(req, currentConfig.localResponses);
                if (answer !== null) {
                    ownLogger.debug(`token-saver: local response triggered for kind=${answer.kind}`);
                    if (currentConfig.telemetry?.onLocalResponse) {
                        // The estimates are the SIMULATED cost of the upstream call this
                        // local answer replaced. They are reported as estimates only —
                        // the stream itself reports zero real consumption, because no
                        // upstream model was called.
                        const estimate = localAnswerEstimate(answer);
                        currentConfig.telemetry.onLocalResponse({
                            kind: answer.kind,
                            model: answer.model,
                            promptTokensEstimate: estimate.promptTokensEstimate,
                            savedTokensEstimate: estimate.savedTokensEstimate,
                        });
                    }
                    return createLocalResponseStream(answer);
                }
            }
            // B) Prompt shaping (Caveman & Ponytail)
            //
            // NOTE: the request handed to `llm/stream` is deep-frozen by the agent
            // loop, so it cannot be mutated in place on the real agent path. The
            // shaping prompt therefore reaches the model through the
            // `system-prompt/assemble` waterfall (registered above), which is where
            // DSH builds the model-facing system prompt.
            //
            // The in-place path is kept for callers that hand over a mutable
            // payload. It is dedup-guarded: when the rendered system prompt already
            // carries the marker (the normal DSH case), this is a no-op.
            if (currentConfig.cavemanLevel !== 'off' || currentConfig.ponytailLevel !== 'off') {
                const active = activePrompts({
                    caveman: currentConfig.cavemanLevel,
                    ponytail: currentConfig.ponytailLevel,
                });
                if (active.length > 0 && req) {
                    const promptText = active.map((p) => p.text).join('\n\n');
                    try {
                        injectSystem(req, undefined, promptText);
                    }
                    catch {
                        // Frozen/readonly options: skip injection, fail open.
                    }
                }
            }
            // C) In-flight request tool message compaction (RTK)
            if (currentConfig.rtkEnabled && req) {
                try {
                    // Only actual compression hits advance the shared stats; mergeRtkStats
                    // ignores no-op results, so uncompressed requests add nothing.
                    const streamStats = compressMessages(req, { enabled: true });
                    mergeRtkStats(rtkStats, streamStats);
                    // Persist the same invocation exactly once; `streamStats` is this
                    // request's own accumulator, never the shared one.
                    statsStore.record(streamStats);
                }
                catch {
                    // Frozen/readonly options: skip, fail open.
                }
            }
        }
        catch (err) {
            // Fail-open: log and let regular LLM handle the request
            ownLogger.warn(`token-saver: llm/stream hook error: ${err.message}`);
        }
        return next();
    };
    scope.on('llm/stream', llmStreamListener);
    // 4) Prompt-cache layout stabilization
    const systemPromptRegistry = makeSystemPromptRegistry(scope);
    if (systemPromptRegistry) {
        systemPromptRegistry.register((sections) => {
            const arr = Array.isArray(sections) ? sections : [];
            const result = stabilizeForCache({
                sections: arr,
                config: resolved,
            });
            if (result.reordered) {
                ownLogger.debug(`token-saver: prompt-cache stable reorder applied (cacheable=${result.cacheableRatio.toFixed(2)})`);
            }
            return result.sections;
        });
    }
    // 5) Optional LLM-summary compaction replacement
    if (resolved.replaceBasicCompaction) {
        const engineImpl = new LlmSummaryCompactionEngine({
            config: resolved,
            logger: ownLogger,
            telemetry: resolved.telemetry,
            callLlm,
            sessionEventsProvider,
        });
        replaceCompactionProvider(scope, engineImpl, ownLogger);
    }
    if (typeof scope.effect === 'function') {
        scope.effect(() => () => {
            ownLogger.info('token-saver: unloading plugin');
        });
    }
}
async function handlePostTool(exec, result, next, resolved, rtkStats, statsStore) {
    const payload = { exec, result };
    // A per-call accumulator keeps one tool result from being counted into the
    // session totals and the persisted totals a second time.
    const callStats = createRtkStats();
    const folded = decidePostTool(payload, {
        config: resolved,
        telemetry: resolved.telemetry,
        rtkStats: callStats,
    });
    const upstream = typeof next === 'function' ? await next() : { kind: 'accept' };
    if (!folded.folded)
        return upstream;
    if (upstream.kind === 'block')
        return upstream;
    if (upstream.kind === 'accept' && upstream.value !== undefined)
        return upstream;
    // Only the folded result that actually reaches the model counts as savings.
    if (rtkStats)
        mergeRtkStats(rtkStats, callStats);
    statsStore?.record(callStats);
    return { ...upstream, ...folded.decision };
}
async function handlePreStep(rawPayload, next, resolved, ctx) {
    const payload = rawPayload;
    return decidePreStep(payload, {
        config: resolved,
        logger: ctx.logger,
        telemetry: ctx.telemetry,
        getTokenMeter: ctx.getTokenMeter,
        getCompactionEngine: ctx.getCompactionEngine,
        agentForSession: ctx.agentForSession,
    }, next);
}
function asScope(input) {
    if (!input || typeof input !== 'object')
        return undefined;
    const obj = input;
    if (typeof obj.on !== 'function')
        return undefined;
    if (typeof obj.effect !== 'function')
        return undefined;
    return obj;
}
function asTokenSaverConfig(input) {
    if (!input || typeof input !== 'object')
        return {};
    return input;
}
function makeTokenMeterAccessor(scope) {
    return (sessionId) => {
        const tm = scope.get('tokenMeter');
        if (!tm || typeof tm !== 'object')
            return undefined;
        const obj = tm;
        if (typeof obj.for === 'function') {
            const meter = obj.for(sessionId);
            return meter && typeof meter === 'object' ? meter : undefined;
        }
        if ('current' in obj && 'capacity' in obj)
            return obj;
        return undefined;
    };
}
function makeCompactionAccessor(scope) {
    return () => {
        const engine = scope.get('compaction');
        if (!engine || typeof engine !== 'object')
            return undefined;
        return engine;
    };
}
function makeAgentAccessor(scope) {
    return (sessionId) => {
        const agents = scope.get('agents');
        if (!agents || typeof agents !== 'object')
            return undefined;
        const obj = agents;
        if (typeof obj.for === 'function') {
            const a = obj.for(sessionId);
            return a && typeof a === 'object' ? a : undefined;
        }
        return undefined;
    };
}
function makeSessionEventsAccessor(scope) {
    const sessions = scope.get('sessions');
    const obj = sessions;
    if (!obj || typeof obj.get !== 'function') {
        return () => [];
    }
    return (session) => {
        const get = obj.get;
        const s = get(session.id);
        if (!s || typeof s !== 'object')
            return [];
        const events = s.events;
        return typeof events === 'function' ? events.call(s) : [];
    };
}
function makeSystemPromptRegistry(scope) {
    const sp = scope.get('systemPrompt');
    if (!sp || typeof sp !== 'object')
        return undefined;
    if (typeof sp.register !== 'function')
        return undefined;
    return {
        register: (fn) => {
            ;
            sp.register(fn);
        },
    };
}
function replaceCompactionProvider(scope, engineImpl, logger) {
    const obj = scope;
    const registry = obj.registry;
    if (!registry) {
        logger.warn('token-saver: replaceBasicCompaction requested but no scope.registry; skipping replacement');
        return;
    }
    if (typeof registry.replace === 'function') {
        registry.replace('compaction', engineImpl);
    }
    else if (typeof registry.register === 'function') {
        registry.register('compaction', engineImpl);
    }
    logger.warn('token-saver: replaceBasicCompaction=true is in effect; dsh-compaction-basic has been replaced.');
}
function makeLlmCaller(_resolved, logger) {
    return async (_input) => {
        logger.warn('token-saver: LLM-summary called without an explicit callLlm provider; returning empty summary. Provide one via plugin apply options in dsh harness home.');
        return { summary: [], shadowedTokenCount: 0 };
    };
}
function createDefaultLogger() {
    const prefix = '[token-saver]';
    return {
        debug: (msg, ...rest) => console.debug(prefix, msg, ...rest),
        info: (msg, ...rest) => console.info(prefix, msg, ...rest),
        warn: (msg, ...rest) => console.warn(prefix, msg, ...rest),
        error: (msg, ...rest) => console.error(prefix, msg, ...rest),
    };
}
export const plugin = {
    name,
    Config,
    inject,
    apply,
};
export default plugin;
export { DEFAULT_COMPACTION_PROMPT, LlmSummaryCompactionEngine };
export { decidePostTool } from './strategies/tool-result-trim.js';
export { decidePreStep } from './strategies/context-pressure.js';
export { stabilizeForCache } from './strategies/prompt-cache.js';
export { resolveConfig, TokenSaverSchema, DEFAULTS };
export * from './rtk/index.js';
export * from './prompt-shaping/index.js';
export * from './local-responses/index.js';
export * from './token-saver/index.js';
