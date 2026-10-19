import { resolveConfig, TokenSaverSchema, DEFAULTS } from './config.js';
import { decidePostTool } from './strategies/tool-result-trim.js';
import { decidePreStep } from './strategies/context-pressure.js';
import { stabilizeForCache } from './strategies/prompt-cache.js';
import { LlmSummaryCompactionEngine, DEFAULT_COMPACTION_PROMPT } from './strategies/llm-summary.js';
import { createRtkStats } from './rtk/index.js';
import { activePrompts, hasAnyPromptShaping, injectIntoSystemPrompt, } from './prompt-shaping/index.js';
import { detectOptimization, createLocalResponseStream, } from './local-responses/index.js';
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
    const rtkStats = createRtkStats();
    // 1) Tool result trimming + RTK filter hook
    const trimmedListener = (arg1, arg2, arg3) => {
        // DSH waterfall event 'tools/post-execute' passes 3 arguments:
        // (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>)
        if (typeof arg3 === 'function') {
            const exec = arg1;
            const result = (arg2 ?? {});
            const next = arg3;
            return handlePostTool(exec, result, next, resolved, rtkStats);
        }
        // Backward compatibility for 2-argument signature: ({ exec, result }, next)
        if (typeof arg2 === 'function') {
            const payload = arg1;
            const exec = payload?.exec ?? arg1;
            const result = (payload?.result ?? {});
            const next = arg2;
            return handlePostTool(exec, result, next, resolved, rtkStats);
        }
        // Defensive fallback when invoked without next
        const exec = arg1;
        const result = (arg2 ?? {});
        const next = () => Promise.resolve({ kind: 'accept' });
        return handlePostTool(exec, result, next, resolved, rtkStats);
    };
    // 2) Context pressure pre-step hook
    const preStepListener = (rawPayload, rawNext) => {
        const next = typeof rawNext === 'function'
            ? rawNext
            : () => Promise.resolve({ kind: 'enter' });
        return handlePreStep(rawPayload, next, resolved, {
            logger: ownLogger,
            telemetry: resolved.telemetry,
            getTokenMeter: tokenMeter,
            getCompactionEngine: compactionEngine,
            agentForSession,
        });
    };
    scope.on('tools/post-execute', trimmedListener);
    scope.on('agent/pre-step', preStepListener);
    // 3) Global LLM Stream hook: Local responses & Prompt shaping
    const llmStreamListener = function (options, next) {
        try {
            const req = options;
            // A) Local responses (quota, prefix, title, suggestion, filepath)
            if (resolved.localResponsesEnabled && req) {
                const answer = detectOptimization(req, resolved.localResponses);
                if (answer !== null) {
                    ownLogger.debug(`token-saver: local response triggered for kind=${answer.kind}`);
                    if (resolved.telemetry?.onLocalResponse) {
                        resolved.telemetry.onLocalResponse({
                            kind: answer.kind,
                            model: answer.model,
                        });
                    }
                    return createLocalResponseStream(answer);
                }
            }
            // B) Prompt shaping (Caveman & Ponytail)
            if (resolved.cavemanLevel !== 'off' || resolved.ponytailLevel !== 'off') {
                const active = activePrompts({
                    caveman: resolved.cavemanLevel,
                    ponytail: resolved.ponytailLevel,
                });
                if (active.length > 0 && req) {
                    const promptText = active.map((p) => p.text).join('\n\n');
                    const sys = typeof req.system === 'string' ? req.system : '';
                    if (!hasAnyPromptShaping(sys)) {
                        const injected = injectIntoSystemPrompt(sys, promptText);
                        if (injected.injected) {
                            // Mutate the request options in place: the waterfall passes the
                            // SAME options object downstream, so writing system here is how
                            // the shaped prompt reaches the real model request.
                            try {
                                ;
                                options.system = injected.text;
                            }
                            catch {
                                // Frozen/readonly options: skip injection, fail open.
                            }
                            return next();
                        }
                    }
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
async function handlePostTool(exec, result, next, resolved, rtkStats) {
    const payload = { exec, result };
    const folded = decidePostTool(payload, {
        config: resolved,
        telemetry: resolved.telemetry,
        rtkStats,
    });
    const upstream = typeof next === 'function' ? await next() : { kind: 'accept' };
    if (!folded.folded)
        return upstream;
    if (upstream.kind === 'block')
        return upstream;
    if (upstream.kind === 'accept' && upstream.value !== undefined)
        return upstream;
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
