# DSH 0.2.1-rc.2 — `llm/stream` runtime contract and LLM request/response shapes

Read-only research report. Every claim below is anchored to a file path and line number in the
installed packages under:

```
PNPM_ROOT=/home/lovedolove/.local/share/pnpm/global/v11/f8d-18e03afe7f7000d2-2/node_modules/.pnpm
```

Package short names used below:

| Short name | Full package dir |
|---|---|
| `LLM` | `@deepseek-ai+dsh-llm@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-llm` |
| `PIAI` | `@deepseek-ai+dsh-llm-pi-ai@0.2.1-rc.2_.../node_modules/@deepseek-ai/dsh-llm-pi-ai` |
| `DSA` | `@deepseek-ai+dsh-llm-deepseek@0.2.1-rc.2_.../node_modules/@deepseek-ai/dsh-llm-deepseek` |
| `LOOP` | `@deepseek-ai+dsh-agent-loop@0.2.1-rc.2_.../node_modules/@deepseek-ai/dsh-agent-loop` |
| `SP` | `@deepseek-ai+dsh-system-prompt@0.2.1-rc.2_.../node_modules/@deepseek-ai/dsh-system-prompt` |

All paths below are relative to `PNPM_ROOT`.

---

## 1. The `llm/stream` event

### 1.1 Type declaration (verbatim)

`LLM/lib/types/index.d.ts:28-47`

```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        llm: LlmRuntime;
    }
    interface Events {
        /**
         * Waterfall around every streaming model call (retry, replay, routing).
         * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
         * adapter's stream, or yield your own chunks to short-circuit.
         * @param options - the full request. A LOOP-built request carries the
         *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
         *   (mutation throws): its content is a pure function of the session log (the
         *   reconstructability Agent Note), so listeners read it, never rewrite it.
         *   Hand-built calls do not carry that marker; callers own their request
         *   inputs and must keep them unchanged until the stream settles.
         * @mode waterfall
         */
        'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
    }
}
```

**Answer: yes — it is exactly `(options, next)`, where `next()` returns an `AsyncIterable<StreamChunk>`.**
`this` inside the listener is bound to the `LlmRuntime` instance.

There is **no other `llm/*` streaming event**. The only other `llm/` events in the whole
`@deepseek-ai/dsh-llm` package are:

- `LLM/lib/types/types.d.ts:21` — `'llm/adapters-updated'(): void`
- `LLM/lib/types/types.d.ts:297` — `'llm/model-discovery-rejected': { ... }`

### 1.2 The emit site (verbatim)

`LLM/lib/index.js:2393-2398`

```js
		stream(options) {
			return this.streamWithRegistration(options);
		}
		streamWithRegistration(options, prepared) {
			return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
		}
```

Identical code exists in the types-suffixed copy at `LLM/lib/types/index.js:956`.

Note: **the prepared-call path also goes through the same waterfall** — `LLM/lib/index.js:2249-2259`:

```js
					stream: (options) => {
						if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
						if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
						dispatched = true;
						return this.streamWithRegistration(options, {
							registration,
							config: resolvedConfig,
							modelInfo,
							dispatch: (options) => adapterCall.stream(options)
						});
					}
```

So **every** model call — main conversation, compaction, session-title — passes through the hook.

### 1.3 Waterfall semantics (why not calling `next()` short-circuits)

`@deepseek-ai/cordis@4.0.5_.../node_modules/@deepseek-ai/cordis/lib/index.js:305-325`

```js
	/**
	 * Compose listeners around the final `next` callback.
	 *
	 * The last dispatch argument is treated as the innermost `next`. Listeners
	 * run outermost-first; a listener that does not call `next()` vetoes the
	 * rest of the chain, including the built-in behavior.
	 *
	 * @param args — optional `this`, the event name, listener arguments, then `next`.
	 * @returns the outermost listener's return value.
	 */
	waterfall(...args) {
		const cbs = this.dispatch("waterfall", args);
		const inner = args.pop();
		const next = () => {
			return (cbs.shift() ?? inner)(...args);
		};
		args.push(next);
		return next();
	}
```

`next` is **synchronous** and returns whatever the next listener (or the built-in inner function)
returns — here, the `AsyncIterable<StreamChunk>`. A listener that returns its own `AsyncIterable`
without calling `next()` fully vetoes the adapter stream.

### 1.4 In-tree examples of the hook (canonical usage patterns)

**Observing only** — `dsh-session-title/lib/index.js:262-268`:

```js
		ctx.on("llm/stream", (options, next) => {
			this.onMainRequest(options);
			return next();
		}, { global: true, prepend: true });
```

**Observing + wrapping** — `dsh-session-checkpoint-policy/lib/index.js:61-65`:

```js
		ctx.on("llm/stream", (options, next) => {
			if (options.sessionId === void 0) return next();
			const session = ctx.sessions.get(options.sessionId);
			return session === void 0 ? next() : afterCheckpoint(ctx, session, next);
		});
```

**`isAgentLoopRequest` is the way to detect a MAIN conversation request** —
`dsh-session-title/lib/index.js:418-428`:

```js
	onMainRequest(options) {
		if (!this.serviceActive() || options.sessionId === void 0 || !isAgentLoopRequest(options)) return;
		...
	}
```

`isAgentLoopRequest` / `markAgentLoopRequest` are exported from `@deepseek-ai/dsh-llm`
(`LLM/lib/types/index.d.ts:26`):

```ts
export { callConfigEquals, isAgentLoopRequest, markAgentLoopRequest } from './call-config.ts';
```

---

## 2. The request options object — `GenerateOptions`

### 2.1 Full interface (verbatim)

`LLM/lib/types/types.d.ts:505-548`

```ts
/** A single model request, fully assembled. */
export interface GenerateOptions {
    /** Registered provider route selecting the adapter instance. */
    provider: string;
    model: string;
    /** Adapter-owned reasoning effort selected for this exact model. */
    reasoningEffort?: ReasoningEffortId;
    /**
     * Ordered conversation messages, exactly as the provider sees them. A
     * loop-built request passes the derived history (dsh-agent-loop), whose
     * leading system-role message carries the system prompt; a hand-built
     * one-shot may include identity-free user inputs.
     */
    messages: RequestMessage[];
    /**
     * System prompt text for one-shot callers; adapters map it to the
     * provider's system slot ahead of `messages`. Loop-built requests leave
     * it undefined.
     */
    system?: string;
    /** Tool definitions offered to the model for this request. */
    tools?: ToolSchema[];
    /** Logged tool declarations and update identities since the last declaration reset. */
    toolHistory?: ToolHistory;
    temperature?: number;
    maxTokens?: number;
    /**
     * Stop sequences; the provider stops before emitting any of them. The
     * stop string itself is not included in the output.
     */
    stop?: string[];
    signal?: AbortSignal;
    /**
     * Session identity stamped by the loop for request routing. Replay uses
     * it to separate cursors; adapters may map it to model-hidden transport metadata.
     */
    sessionId?: Branded<'SessionId'>;
    /**
     * Provider-neutral classification for an auxiliary model call. Adapters may
     * map the purpose to model-hidden transport metadata. Ordinary conversation
     * requests leave it unset.
     */
    purpose?: 'compaction' | 'session-title';
}
```

### 2.2 Field-by-field answers

| Question | Answer |
|---|---|
| `messages`? | **Yes** — `messages: RequestMessage[]` (required). `RequestMessage = Message \| RequestUserInput` (`types.d.ts:492`). `Message` roles: `'system' \| 'developer' \| 'user' \| 'assistant' \| 'tool'` (`LLM/lib/types/message.d.ts:136-174`). |
| `system` / `systemPrompt`? | **`system?: string`** — a single string, NOT an array and NOT named `systemPrompt`. Only one-shot callers set it; loop requests leave it `undefined` and carry the system prompt as the leading `role: 'system'` message inside `messages`. |
| `tools`? | **Yes** — `tools?: ToolSchema[]`. `ToolSchema` (`types.d.ts:472-483`) = `{ deferLoading?: true; name: string; description: string; parameters: Record<string, unknown> }`. |
| `maxTokens` / `max_tokens`? | **`maxTokens?: number`** (camelCase, optional). Never `max_tokens` in `GenerateOptions`. |
| `model`? | **Yes** — `model: string` (required). |
| `provider`? | **Yes** — `provider: string` (required). |
| `purpose`? | **Yes** — `purpose?: 'compaction' \| 'session-title'`. See §7. |

### 2.3 OTHER fields DSH sets that a plugin currently ignores

| Field | Present? | Notes |
|---|---|---|
| `signal` | **Yes** (`signal?: AbortSignal`) | Aborts the call. |
| `sessionId` | **Yes** (`sessionId?: Branded<'SessionId'>`) | Stamped by the agent loop. **This is the key request-type discriminator** for auxiliary vs. main calls. |
| `purpose` | **Yes** | `'compaction'` / `'session-title'` only. |
| `toolHistory` | **Yes** (`toolHistory?: ToolHistory`) | `{ tools: readonly ToolSchema[]; updates: readonly { messageId; additions }[] }` (`types.d.ts:494-504`). |
| `reasoningEffort` | **Yes** (`reasoningEffort?: ReasoningEffortId`) | |
| `temperature` | **Yes** | |
| `stop` | **Yes** (`stop?: string[]`) | |
| `metadata` | **NO** | No `metadata` field exists. |
| `responseFormat` | **NO** | No such field. |
| `cacheControl` | **NO** | No such field. |
| `thinking` | **NO** | Not a `GenerateOptions` field — it is derived by the adapter from `reasoningEffort` (see `DSA/lib/index.js:1714-1731`, which builds `thinking: { type: effort === "off" ? "disabled" : "enabled" }` on the wire). |

**IMPORTANT — `maxTokens` is already RESOLVED when the hook sees it.** `LLM/lib/index.js:2182-2198`
(`resolveCallWithInfo`) applies the adapter's default before the request reaches the hook:

```js
		const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0
			? { ...config, maxTokens: info.defaultMaxTokens }
			: config;
```

### 2.4 Which fields are relevant for detecting the request TYPE

There are exactly **three** reliable discriminators, in order of strength:

1. **`isAgentLoopRequest(options)`** — `true` for main conversation turns (the loop stamps the
   request object via `markAgentLoopRequest`); `false` for hand-built one-shot calls.
   Source: `LLM/lib/types/call-config.js` (module-level `WeakSet AGENT_LOOP_REQUESTS`).
2. **`options.purpose`** — `'compaction'` | `'session-title'` | `undefined`.
3. **`options.sessionId`** — present on both loop requests and the two auxiliary calls; useless
   alone but required to look up the session.

**The loop-built request** (`LOOP/lib/index.js:1281-1289`, verbatim):

```js
			return markAgentLoopRequest(Object.freeze({
				...header.config,
				messages: boundaryMessages,
				toolHistory: session.toolHistory(),
				...(header.tools !== void 0 ? { tools: header.tools } : {}),
				sessionId: this.session.id,
				signal
			}));
```

Note: the loop request has **no `purpose`** and **no `system`**; the system prompt rides as the
leading `role: 'system'` message inside `messages`. The request is **`Object.freeze`d** (and the
doc says "arrives deep-frozen (mutation throws)"). `messages` and `header` are separately frozen
at `LOOP/lib/index.js:1273,1277,1280`.

**The compaction request** (`dsh-compaction-basic/lib/index.js:308-323`):

```js
		const options = {
			provider: target.provider,
			model: target.model,
			messages,
			toolHistory: agent.session.toolHistory(),
			...tools,
			maxTokens: config.maxTokens,
			sessionId: agent.session.id,
			purpose: "compaction",
			...signal
		};
```

**The session-title request** (`dsh-session-title-llm/lib/index.js:191-198`):

```js
		const options = deepFreeze({
			...call.config,
			messages,
			system: prepared.system,
			sessionId: request.session.id,
			purpose: "session-title",
			signal: callDeadline.signal
		});
```

---

## 3. The response stream shape — `StreamChunk`

### 3.1 The union (verbatim)

`LLM/lib/types/types.d.ts:434-464`

```ts
export type StreamChunk =
    | { type: 'block-start'; index: number; blockType: ContentBlockType }
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'reasoning-delta'; index: number; text: string }
    | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
    | { type: 'block-end'; index: number; block: ContentBlock }
    | { type: 'usage'; usage: TokenUsage }
    | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope };
```

Doc (`types.d.ts:426-433`):

> Raw streaming protocol emitted by adapters. Block indexes correlate interleaved deltas, and
> `block-end` carries the assembled block. Adapters emit usage before the terminal finish and
> nothing afterward; tool arguments remain raw JSON strings. An adapter implementation may throw,
> but `LlmRuntime.stream()` normalizes that failure to a terminal `error` or `aborted` finish
> before exposing it to consumers.

### 3.2 Are the item types literally `'block-start' | 'text-delta' | 'block-end' | 'usage' | 'finish'`?

**Not exactly — there are SEVEN variants.** The list is:

`block-start` | `text-delta` | `reasoning-delta` | `tool-call-delta` | `block-end` | `usage` | `finish`

`reasoning-delta` and `tool-call-delta` are missing from your proposed list and **must** be
handled by any plugin that short-circuits the stream.

### 3.3 Exact property names

| Chunk | Properties |
|---|---|
| `block-start` | `index: number`, `blockType: ContentBlockType` — **no `id`, no `text`** |
| `text-delta` | `index: number`, **`text: string`** — NOT `delta`, NOT `content` |
| `reasoning-delta` | `index: number`, **`text: string`** |
| `tool-call-delta` | `index: number`, `id: ToolCallId`, `name?: string`, **`argumentsDelta: string`** — NOT `arguments`, NOT `delta` |
| `block-end` | `index: number`, `block: ContentBlock` (the fully assembled block) |
| `usage` | **`usage: TokenUsage`** (nested!) |
| `finish` | **`reason: FinishReason`**, `replayState?: ReplayEnvelope` |

### 3.4 `TokenUsage` (verbatim)

`LLM/lib/types/types.d.ts:160-174`

```ts
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
```

Doc (`types.d.ts:152-159`):

> Counts are DISJOINT: `inputTokens` is uncached input only; cached input is reported separately
> as `cacheReadTokens`/`cacheWriteTokens` (billed input = sum of the three).

**Answer to "does usage use `inputTokens`, `input_tokens`, or `input`?" → `inputTokens`**
(camelCase, no `input_tokens`, no `input`). And the usage chunk is `{ type: 'usage', usage: {...} }`
— the counts are **nested under `usage`**, not flattened onto the chunk.

### 3.5 `FinishReason` — CRITICAL: it is an OBJECT, not a string

`LLM/lib/types/types.d.ts:131-151`

```ts
export type FinishReasonMap = {
    'stop': { kind: 'stop' };
    'tool-calls': { kind: 'tool-calls' };
    'max-tokens': { kind: 'max-tokens' };
    'aborted': { kind: 'aborted'; failure: LlmFailure };
    'error': { kind: 'error'; failure: LlmFailure };
};
export type FinishReason = FinishReasonMap[keyof FinishReasonMap];
```

So the correct `finish` chunk for a normal stop is:

```ts
{ type: 'finish', reason: { kind: 'stop' } }
```

**NOT** `{ type: 'finish', reason: 'stop' }`. Every in-tree consumer reads `.kind`:

- `LOOP/lib/index.js:1129-1130` — `const finish = live.finish; if (finish.kind === "error" || finish.kind === "aborted")`
- `LOOP/lib/index.js:1163` — `if (finish.kind === "max-tokens") return { kind: "max-tokens" };`
- `dsh-compaction-basic/lib/index.js:358-369` — `finishError(finish)` switches on `finish.kind`
- `dsh-session-title-llm/lib/index.js:130-144` — `terminalFinish(finish)` switches on `finish.kind`
- `dsh-client-ui-chat/lib/client.js:3647` — `location.turn.end?.data.reason.kind`

### 3.6 `ContentBlock` and `ContentBlockType`

`LLM/lib/types/types.d.ts:114-126`

```ts
export type ContentBlockMap = {
    'text': TextBlock;
    'reasoning': ReasoningBlock;
    'image': ImageBlock;
    'file': FileBlock;
    'tool-call': ToolCallBlock;
    'tool-addition': ToolAdditionBlock;
    'tool-removal': ToolRemovalBlock;
};
export type ContentBlockType = keyof ContentBlockMap;
export type ContentBlock = ContentBlockMap[ContentBlockType];
```

Block shapes (`types.d.ts:45-92`):

```ts
export interface TextBlock { type: 'text'; text: string; }
export interface ReasoningBlock { type: 'reasoning'; text: string; }
export interface ToolCallBlock { type: 'tool-call'; id: ToolCallId; name: string; arguments: string; }  // raw JSON string
```

`LLM/lib/types/types.d.ts:413-425`:

```ts
export type ReplayEnvelope = { response: unknown; blocks?: readonly unknown[] };
```

### 3.7 The canonical assembly algorithm — `BlockAssembler`

`LLM/lib/index.js:940-1005` (and `LLM/lib/types/assembler.js`, 191 lines) is the reference
implementation of how chunks are folded into a message. Its `push(chunk)` switch:

- `block-start` → creates a partial `{ blockType, text: '', toolCallArguments: '' }` at `index`
- `text-delta` / `reasoning-delta` → `partial.text += chunk.text` (stragglers after `block-end` ignored)
- `tool-call-delta` → `partial.toolCallId = chunk.id`; `if (chunk.name) partial.toolCallName = chunk.name`; `partial.toolCallArguments += chunk.argumentsDelta`
- `block-end` → `partial.block = chunk.block` (**first close wins**: `if (partial.block) return;`)
- `usage` → `this._usage = chunk.usage`
- `finish` → `this._finish = chunk.reason`; `this._replayState = chunk.replayState`
- `default:` → `assertNever(chunk, "BlockAssembler.push")` → **throws** on an unknown `chunk.type`

`LLM/lib/types/assembler.js:167-173`:

```js
    get usage() { return this._usage; }
    get finish() { return this._finish ?? { kind: "stop" }; }
```

**Two consequences for a short-circuiting plugin:**
1. An unknown chunk `type` **throws** inside the assembler (`assertNever` — `dsh-util-values/lib/index.js:639-642`).
2. **A stream that ends WITHOUT a `finish` chunk is treated as `{ kind: "stop" }`** — no error is
   raised. But you should still emit an explicit `finish` chunk, because
   `dsh-client-ui-chat` reads `usage` and the terminal `reason` off the stream.

### 3.8 Downstream consumers of the chunk shape

`dsh-client-ui-chat/lib/client.js:7881-7888` (the UI's own copy of the delta rules):

```js
        function isTokenDelta(chunk) {
            switch (chunk.type) {
                case "text-delta":
                case "reasoning-delta": return chunk.text !== "";
                case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== void 0;
                default: return false;
            }
        }
```

`dsh-client-ui-chat/lib/client.js:7932-7969` (`updateChunk`) reads `chunk.index`, `chunk.blockType`,
`chunk.text`, `chunk.argumentsDelta`.

`@deepseek-ai/dsh-llm` also exports the helper functions
`isTokenDelta`, `isVisibleChunk`, `chunkHasVisibleText`
(`LLM/lib/types/assistant-stream.d.ts:78,87,94`; impl `LLM/lib/types/assistant-stream.js:185,204,223`).

---

## 4. How the LLM layer maps provider responses to chunks

### 4.1 Anthropic Messages SSE (direct DeepSeek/Anthropic adapter) — `DSA/lib/index.js:1928-2020`

This is the reference `translate(events, model)` implementation:

| Anthropic SSE event | StreamChunk emitted |
|---|---|
| `message_start` | (no chunk) → `updateUsage` |
| `content_block_start` | `{ type: "block-start", index: block.index, blockType: block.content.type }` (+ optional `text-delta` / `reasoning-delta` / `tool-call-delta` with `argumentsDelta: ""`) |
| `content_block_delta` | `deltaChunk()` → `text-delta` / `reasoning-delta` / `tool-call-delta` |
| `content_block_stop` | `{ type: "block-end", index, block: {...} }` |
| `message_delta` | stop_reason + `updateUsage` |
| `message_stop` | `usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)` (`:2006`) → `{ type: "usage", usage }` (`:2007-2010`) → `{ type: "finish", reason, replayState: replayState(model, ...) }` (`:2011-2015`) |

Stream ending before `message_stop` → `throw new LlmError("DeepSeek Messages stream ended before message_stop", "STREAM_CLOSED")` (`:2019`).

The Anthropic `usage` maps to `{ inputTokens, outputTokens }` and `totalTokens` is **computed** by the adapter.

### 4.2 pi-ai event stream → chunks — `PIAI/lib/index.js:1537-1653` (`toStreamChunks`)

| pi-ai event | StreamChunk emitted |
|---|---|
| `text_start` | `{ type: "block-start", index: event.contentIndex, blockType: "text" }` |
| `text_delta` | `{ type: "text-delta", index, text: event.delta }` |
| `text_end` | `{ type: "block-end", index, block: { type: "text", text: event.content } }` |
| `toolcall_start` | `{ type: "block-start", index, blockType: "tool-call" }` |
| `toolcall_delta` | `{ type: "tool-call-delta", index, id: brandString(known?.id ?? ""), ...(known?.name ? { name: known.name } : {}), argumentsDelta: event.delta }` |
| `toolcall_end` | `{ type: "block-end", index, block: { type: "tool-call", id: brandString(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) } }` |
| `done` | `{ type: "usage", usage: mapUsage(event.message.usage) }` then `{ type: "finish", reason: mapStopReason(...), replayState: toPiReplayState(...) }` |
| `error` | `usage` chunk, then `finish` chunk |
| stream end w/o terminal event | `throw new LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED")` |

**`usage` derivation** — `PIAI/lib/index.js:1439-1446` (`mapUsage`):

```js
    {
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.totalTokens,
        ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
        ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {})
    }
```

pi-ai's own names are `input` / `output` / `cacheRead` / `cacheWrite`; **DSH renames them** to
`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`. `totalTokens` is passed
through verbatim when present (it may be `undefined`).

**`reason` derivation** — `PIAI/lib/index.js:1470-1500` (`mapStopReason`): `"stop"` → `{ kind: "stop" }`
(→ `EMPTY_RESPONSE` error if the content is empty), `"length"` → `{ kind: "max-tokens" }`,
`"toolUse"` → `{ kind: "tool-calls" }`, context overflow → `{ kind: "error", failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } }`.

---

## 5. Is there a canonical "request wire" concept?

**YES — `GenerateOptions` IS the canonical internal request shape. The `llm/stream` hook sees a
PROVIDER-NEUTRAL request, never a raw provider body.**

### 5.1 The code path that builds the request passed to the hook

1. The agent loop builds a `GenerateOptions` (`LOOP/lib/index.js:1281-1289`, see §2.4) — or a
   one-shot caller does (`dsh-session-title-llm`, `dsh-compaction-basic`).
2. `LlmRuntime.stream(options)` → `streamWithRegistration` → `ctx.waterfall(this, "llm/stream", options, ...)`
   (`LLM/lib/index.js:2393-2398`). **The hook receives the exact `GenerateOptions` object.**
3. Only *after* the waterfall does the adapter run: `adapterStream` (`LLM/lib/index.js:2309-2353`)
   merges the resolved config, projects files/images/tool-updates, and dispatches to the adapter.

### 5.2 What the wire looks like (adapter-side, downstream of the hook)

The provider-specific shapes are built **inside the adapters**, after the hook:

**OpenAI Chat Completions** (third-party `@earendil-works/pi-ai@1.3.0`, `dist/api/openai-completions.js`):

```js
577:    stream: true,
539:    messages: context.messages,
591-596: if (compat.maxTokensField === "max_tokens") { params.max_tokens = options.maxTokens; }
         else { params.max_completion_tokens = options.maxTokens; }
```

**OpenAI Responses** (`dist/api/openai-responses.js`):

```js
16-17:  const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;   // "OpenAI Responses rejects max_output_tokens below 16"
257-258: input: messages, stream: true,
265:    params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
```

**→ Yes: the OpenAI Responses wire uses `input` instead of `messages`.** But this happens *inside
pi-ai*, downstream of the `llm/stream` hook. The hook still sees `options.messages`.

**Anthropic Messages** (`DSA/lib/index.js:1714-1731`, `serialize()`):

```js
        {
            model,
            stream: true,
            messages,
            max_tokens: options.maxTokens ?? model?.maxTokens ?? connection.maxTokens,
            thinking: { type: effort === "off" ? "disabled" : "enabled" },
            ...(effort === "off" ? {} : { output_config: { effort } }),
            ...(system.length === 0 ? {} : { system }),
            ...(temperature),
            ...(stop_sequences),
            ...(tools)
        }
```

**→ Yes: Anthropic uses a separate top-level `system` field** (and snake_case `max_tokens`).
But again — the hook sees `options.system` (a plain string) and `options.maxTokens` (camelCase).

### 5.3 The DSH pi-ai adapter's system-prompt folding

`PIAI/lib/index.js:1273-1294` — `splitSystemPrompt()` folds `options.system` **and** any leading
`role: 'system'` messages into a single `systemPrompt` string, and `piContext()` returns
`{ systemPrompt?, messages, tools? }`:

```js
    async streamSimple(...)  // at :1983-1986
    snapshot.models.streamSimple(model, context, {
        ...(options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens })
    });
```

**Implication for a plugin that wants to inject a system prompt:** mutate `options.system`
(one-shot) or the leading `role: 'system'` message in `options.messages` (loop) — but the loop
request is frozen, so mutation throws. See §8.3 and the repo findings below.

---

## 6. Errors and early termination

### 6.1 What happens if a plugin returns a synthetic stream without calling `next()`

**The adapter stream is fully vetoed** (Cordis waterfall semantics, §1.3). The plugin's returned
`AsyncIterable<StreamChunk>` becomes the entire stream. Downstream:

- `LOOP/lib/index.js:1084-1091` consumes it:
  ```js
  const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);
  ...
  for await (const chunk of stream) { signal.throwIfAborted(); live.push(chunk); }
  ```
- `live.push(chunk)` → `this.assembler.push(timed.chunk)` (`LOOP/lib/index.js:401`).
- An **unknown `chunk.type`** → `assertNever` throws inside `BlockAssembler.push` → the error
  propagates out of the `for await` → the loop's catch handles it → `turn/end` with
  `{ kind: "error", error: {...} }` (`LOOP/lib/index.js:1019-1026`).
- A **missing `finish` chunk** → `BlockAssembler.finish` defaults to `{ kind: "stop" }` and the
  turn completes normally (`LOOP/lib/index.js:1163-1167`).
- A `finish` chunk with `reason: { kind: "error", failure }` → `LOOP/lib/index.js:1129-1147`:
  dispatches the `agent/request-error` waterfall, and if no listener returns `{ kind: "retry" }`,
  throws `new LlmError(finish.failure.message, finish.failure.code, finish.failure)`.
- A `finish` chunk with `reason: { kind: "max-tokens" }` → `LOOP/lib/index.js:1163` returns
  `{ kind: "max-tokens" }` and the turn ends as `max-tokens`.

### 6.2 Is there a contract? — YES, an implicit one

**There is NO validator in DSH 0.2.1-rc.2.** The old `lib/invariant.js` (which validated chunks in
DSH 0.0.1-rc.5) **does not exist** in 0.2.1-rc.2. So DSH does not reject a malformed synthetic
stream at the hook boundary. The contract is enforced **downstream** by:

1. `BlockAssembler.push` — `assertNever` on an unknown `chunk.type`; `if (partial.block) return;`
   for duplicate `block-end`.
2. `BlockAssembler.finish` — `?? { kind: "stop" }` fallback when no `finish` chunk arrives.
3. `dsh-client-ui-chat` — reads `chunk.index` / `chunk.blockType` / `chunk.text` /
   `chunk.argumentsDelta`; an `undefined` index would corrupt the UI block map.
4. The token meter (`dsh-token-meter/lib/index.js:322-336`) reads `usage.inputTokens`,
   `usage.outputTokens`, `usage.cacheReadTokens` — `totalTokens` is **not** relied on by the meter
   (`dsh-token-meter/lib/index.js:367,675`), but the **UI does** use it
   (`dsh-client-ui-chat/lib/client.js:6849-6850, 10882-10938`).

### 6.3 How DSH itself normalizes an adapter throw

`LLM/lib/index.js:2402-2414` (`adapterFailureChunk`):

```js
function adapterFailureChunk(error, signal) {
    ...
    return {
        type: "finish",
        reason: signal?.aborted || failure.code === "ABORTED"
            ? { kind: "aborted", failure }
            : { kind: "error", failure }
    };
}
```

The doc on `LlmRuntime.stream` (`LLM/lib/types/index.d.ts:426-431`):

> Adapter selection, dispatch, and iteration failures become terminal `error` or `aborted` finish
> chunks; middleware, nested-call, cleanup, and consumer failures remain thrown.

**A plugin that throws inside the hook is "middleware failure" → it stays THROWN, not converted
into a finish chunk.**

### 6.4 Canonical synthetic-stream shape (what a plugin should emit)

Minimum viable, DSH-shaped:

```ts
yield { type: 'block-start', index: 0, blockType: 'text' };
yield { type: 'text-delta', index: 0, text: 'Hello' };
yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } };
yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2 } };
yield { type: 'finish', reason: { kind: 'stop' } };
```

**Gotchas**
- `reason` must be the **object** `{ kind: 'stop' }`, NOT the string `'stop'`.
- `usage` counts must be **nested under `usage`**, and use `inputTokens` / `outputTokens`.
- `text-delta` uses `text`, not `delta` / `content`.
- `tool-call-delta` uses `argumentsDelta`, not `arguments` / `delta`.
- `block-end` must carry the **fully assembled** block (the assembler does NOT re-derive it from
  the deltas it received — it stores `partial.block = chunk.block` verbatim), so the block text
  must equal the concatenation of the deltas.
- Extra non-canonical fields (e.g. `delta`, `input`, `output`) are silently tolerated by the
  assembler but are **not** part of the contract.

---

## 7. The `purpose` field — the exact set of values

### 7.1 The declared union (verbatim)

`LLM/lib/types/types.d.ts:542-547`

```ts
    /**
     * Provider-neutral classification for an auxiliary model call. Adapters may
     * map the purpose to model-hidden transport metadata. Ordinary conversation
     * requests leave it unset.
     */
    purpose?: 'compaction' | 'session-title';
```

**The EXACT set of `purpose` values in DSH 0.2.1-rc.2 is exactly two:**
`'compaction'` and `'session-title'`. There is **no** `'quota'`, no `'title'`, no `'summary'`.

I grepped every `@deepseek-ai/*` package for `purpose: '<literal>'`; the only two assignments to a
`GenerateOptions.purpose` in the whole DSH tree are:

- `dsh-compaction-basic/lib/index.js:320` → `purpose: "compaction",`
- `dsh-session-title-llm/lib/index.js:196` → `purpose: "session-title",`

(Unrelated `purpose` hits in `dsh-api-remote-access` and `dsh-client-ui-*` are a different,
UI-level "user-facing purpose" concept, not the LLM request field.)

### 7.2 Is `'session-title'` real? — **YES, it is real and it IS set**

`dsh-session-title-llm/lib/index.js:191-198`:

```js
		const options = deepFreeze({
			...call.config,
			messages,
			system: prepared.system,
			sessionId: request.session.id,
			purpose: "session-title",
			signal: callDeadline.signal
		});
```

It is consumed by `call.stream(options)` and folded with `new BlockAssembler()` (`:209-213`).

Its `maxTokens` comes from the user-configurable `config.maxOutputTokens`
(`dsh-session-title-llm/lib/index.js:180,183,205`) — **not** a fixed `1`.

### 7.3 `'compaction'` is real and IS set

`dsh-compaction-basic/lib/index.js:320` (see §2.4).

### 7.4 How `purpose` reaches the transport (adapter mapping)

`DSA/lib/index.js:2230-2231` (DeepSeek adapter request headers):

```js
        "x-deepseek-harness-session-id": String(options.sessionId),
        ...(options.purpose === "compaction" ? { "x-deepseek-harness-compact": "1" } : {}),
```

→ **Only `'compaction'` has an adapter-specific mapping. `'session-title'` has NO adapter mapping**
(the adapter just carries `purpose` through `prepareRequestExtensions` at `:2200`).

---

## 8. The `systemPrompt` service

### 8.1 There is NO `systemPromptRegistry` and NO `.register()` in DSH 0.2.1-rc.2

I grepped the **entire** `PNPM_ROOT` tree for `systemPromptRegistry` — **zero hits**. And
`SP/lib/types/index.d.ts` (317 lines) declares **no** `register` method and **no**
`systemPromptRegistry` export.

### 8.2 The actual API

`SP/lib/types/index.d.ts` — `class SystemPrompt extends Service`:

| Member | Line | Signature |
|---|---|---|
| `section` | `:250` | `section(section: PromptSection): () => void` — **registers a prompt section; returns a disposer** |
| `getSectionOrder` | `:256` | `getSectionOrder(name: PromptSectionOrderName): number` |
| `suppressRuntimeContext` | `:276` | `suppressRuntimeContext(): () => void` |
| `tools` | `:284` | `tools(provider: (context: AssembleContext) => ToolProviderResult): () => void` |
| `variable` | `:293` | `variable(name, provider): () => void` |

**`PromptSection`** (`SP/lib/types/index.d.ts:47-70`):

```ts
export interface PromptSection {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: AssembleContext) => string);
    readonly interpolate?: boolean;
    readonly complete?: boolean;
}
```

**`PromptContext`** (`:72-83`):

```ts
export interface PromptContext {
    readonly name: string;
    readonly order: number;
    readonly text: string;
    readonly interpolate?: boolean;
    readonly required?: boolean;
}
```

**`PromptAssembly`** (`:113-118`):

```ts
export interface PromptAssembly {
    sections: AssembledSection[];
    contexts: AssembledContext[];
    tools: ToolSchema[];
    variables: Record<string, string | undefined>;
}
```

### 8.3 The "sections array" and how to add a section

`SP/lib/index.js:253-255` — `section(section)`:

```js
    section(section) {
        ...
        return this.layers.effect(this.ctx, (layer) => layer.sections.insert(section.name, section), { label: "systemPrompt.section()" });
    }
```

Real in-tree usage (`dsh-tool-bash/lib/index.js:376-380`):

```js
    ctx.systemPrompt.section({
        name: "tool:bash",
        order: ctx.systemPrompt.getSectionOrder("TOOL_BASH"),
        text: "Check the [exit code: N] marker on every bash result; investigate failures before moving on."
    });
```

Same pattern in `dsh-tool-jobs:257`, `dsh-tool-goal:259`, `dsh-mcp-client:736`,
`dsh-client-ui-deliverables:264`, `dsh-mcp-resources:119`, `dsh-tool-subagent:509`.

**→ The correct API for a plugin to add a system prompt section is
`ctx.systemPrompt.section({ name, order, text })`, which returns a disposer.** There is no
`register(cb)` that transforms the assembled sections.

### 8.4 Events

`SP/lib/types/index.d.ts:27` — `'system-prompt/assemble'` is a **waterfall**:

```ts
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>;
```

Doc: *"The returned value is authoritative. A registered complete section is restored after this
waterfall, so listeners cannot add to or replace that scope's system prompt."*

`SP/lib/types/index.d.ts:33` — `'system-prompt/change'(): void` (emit).

`SP/lib/index.js:356-404` — `assemble()` runs the waterfall at the end and then restores a
`complete` section.

### 8.5 Relevant order constants

`SECTION_ORDERS`: `TOOL_*` 1000-2700, `MCP_SERVERS` 3100, `TOOLS_SDK` 5000,
`DELIVERABLE_FILE_REFERENCES` 9000, `STRUCTURED_OUTPUT` 9900, `HARNESS_SOURCE` 10000,
`WEB_SURFACE` 10100, `DEPLOYMENT_PERSONA_SUFFIX` 10200.
`CONTEXT_ORDERS`: `WORKING_DIRECTORY` 100, `SANDBOX_POLICY` 110, `APPROVAL_POLICY` 115,
`SUBAGENT_DELEGATION` 120, `FILE_REFERENCE` 900.

### 8.6 Related: `ctx.compaction`

`dsh-compaction/lib/types/index.d.ts:102` — `export declare abstract class CompactionEngine extends Service`;
`:67-70` — `interface Context { compaction: CompactionEngine }`; doc (`:96-100`):
*"Load one implementation per context as `ctx.compaction`."*
**There is NO `scope.registry.replace('compaction', impl)` API in DSH.** Grepping
`scope.registry` / `ctx.registry` across `@deepseek-ai/*` only hits cordis-plugin-loader internals
(`ctx.registry.plugin(...)`, `ctx.registry.has(...)`).

---

## 9. Does DSH have a `max_tokens: 1` quota probe?

**NO. DSH 0.2.1-rc.2 does not send any `maxTokens: 1` / `max_tokens: 1` probe anywhere.**

- Grep for `maxTokens: *1` / `max_tokens: *1` across every `@deepseek-ai/*` package returned only
  **type declarations**:
  - `dsh-llm-deepseek-account/lib/types/listing.d.ts:20` — `readonly maxOutputTokens?: number;`
  - `dsh-session-title-llm/lib/types/index.d.ts:52,66` — `readonly maxOutputTokens: number;`
- Grep for `quota` across DSH: every hit in `dsh-llm` is **error taxonomy**, not a probe:
  - `LLM/lib/index.js:137-182` — provider error regexes such as
    `/\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i`
  - `LLM/lib/types/error.js:23-79` — `QUOTA_EXCEEDED_CODE = "QUOTA"`, `ACCOUNT_QUOTA_EXCEEDED_CODE = "ACCOUNT_QUOTA"`
  - `LLM/lib/types/retry-policy.js:11,17` — `EMPTY_RESPONSE_CODE` / quota codes in the retry policy
  - Remaining hits are in third-party `openai@7.19.0` doc strings and `google-auth-library`.

**Conclusion: a `max_tokens: 1` "quota probe" is a plugin-side invention, not a DSH behavior.**
DSH's own auxiliary calls (compaction, session-title) use configurable, realistic token budgets.

---

## 10. Findings for the repo under study (`/home/lovedolove/projects/dsh-token-saver`)

These are contract mismatches found while reading the repo against the DSH contract above.

### 10.1 `systemPromptRegistry.register(...)` does not exist → silent no-op

`src/index.ts:399-410` (`makeSystemPromptRegistry`):

```ts
  const sp = scope.get('systemPrompt')
  if (!sp || typeof sp !== 'object') return undefined
  if (typeof (sp as {register?: unknown}).register !== 'function') return undefined
```

DSH 0.2.1-rc.2's `SystemPrompt` has **no `.register`**, so this returns `undefined` and the
prompt-cache stabilization block at `src/index.ts:246-261` **never runs**. The intended
transformation API (`stabilizeForCache` returning `{ reordered, cacheableRatio, sections }`) has
no DSH counterpart — DSH's `system-prompt/assemble` waterfall would be the hook point, or
`ctx.systemPrompt.section({ name, order, text })` for adding a section.

### 10.2 `scope.registry.replace('compaction', engineImpl)` does not exist → silent no-op

`src/index.ts:412-434` (`replaceCompactionProvider`). DSH loads **one** compaction engine per
context as `ctx.compaction` (`dsh-compaction/lib/types/index.d.ts:67-70,102`). There is no
registry to replace. The real DSH way is to **provide a different `CompactionEngine`
implementation** (as a plugin that `inject`s `["llm","tokenMeter","sessions"]` like
`dsh-compaction-basic` does) — or to not use `dsh-compaction-basic` at all.

### 10.3 The synthetic stream's `finish.reason` is the WRONG SHAPE

`lib/local-responses/stream.js:1-46` emits:

```js
  { type: 'block-start', index: 0, blockType: 'text' }
  { type: 'text-delta', index: 0, text, delta: text }          // extra non-canonical `delta`
  { type: 'block-end', index: 0, block: { type: 'text', text } }
  { type: 'usage', usage: { inputTokens: input, outputTokens: output, input, output } }  // extra `input`/`output`
  { type: 'finish', reason: 'stop' }                            // ← WRONG: must be { kind: 'stop' }
```

`reason: 'stop'` is a **string**; DSH's `FinishReason` is an **object** `{ kind: 'stop' }`.
Every consumer reads `.kind`:
`LOOP/lib/index.js:1129-1130,1163`; `dsh-compaction-basic/lib/index.js:358-369`;
`dsh-session-title-llm/lib/index.js:130-144`; `dsh-client-ui-chat/lib/client.js:3647,4158,6625`.
With a string reason, `finish.kind` is `undefined` → the error/aborted branches are skipped and
`max-tokens` is not detected. The `block-end` block text also must equal the concatenated deltas
(the assembler stores `chunk.block` verbatim).

Also `usage` is missing `totalTokens` — the **UI relies on it**
(`dsh-client-ui-chat/lib/client.js:6849-6850, 10882-10938`).

### 10.4 The `usage` detector uses wire-style names

`lib/local-responses/detectors.js` — `makeUsage(input, output)` returns
`{ input, output, input_tokens: input, output_tokens: output }` — **not** DSH's `TokenUsage`
(`{ inputTokens, outputTokens, ... }`). The DSH `usage` chunk must use `inputTokens`/`outputTokens`.

### 10.5 The quota detector keys on a non-existent `purpose` value

`lib/local-responses/detectors.js:85-118` (`quotaAnswer`) checks
`request?.purpose === 'quota'` — **`'quota'` is not a valid `GenerateOptions.purpose`** in DSH
0.2.1-rc.2 (§7.1). The `maxTokens === 1` half of the check is also not a DSH behavior (§9), though
it is harmless as a plugin-side heuristic. The `'session-title'` check in `titleAnswer`
(`detectors.js:136-147`) **IS** correct.

### 10.6 Prompt injection into a frozen request will always fail silently

`lib/prompt-shaping/inject.js:137` (`injectSystem`) supports three wire shapes:
`messages` / `responses` (`instructions`) / `chat`. But DSH's `GenerateOptions` has:
- **no** `instructions` field → the `'responses'` branch is dead code for DSH;
- `system?: string` (a **string**, not an array) → the `'messages'` branch, which expects an
  array-shaped `system`, is also mismatched;
- the loop request is **deep-frozen** (`LOOP/lib/index.js:1281-1289` +
  `LLM/lib/types/index.d.ts:37-40` "arrives deep-frozen (mutation throws)").

`src/index.ts:206-219` wraps the injection in a `try/catch` that fails open, so the
prompt-shaping feature is a **no-op on the main conversation path** in DSH 0.2.1-rc.2. The only
viable DSH mechanism for adding a system prompt is `ctx.systemPrompt.section({ name, order, text })`
(§8.3) — i.e. upstream of the request, not inside the `llm/stream` hook.

### 10.7 The `llm/stream` listener shape is correct

`src/index.ts:243`:

```ts
  scope.on('llm/stream', llmStreamListener as unknown as (...args: readonly unknown[]) => unknown)
```

with `llmStreamListener` at `src/index.ts:~176-241` taking `(options, next)` and returning
`next()` in the `finally` — this matches the DSH contract exactly.

---

## 11. Explicit "not found" statements

- **No** `llm/stream` payload beyond `(options, next)` — no third argument, no `this`-scoped
  metadata object.
- **No** `metadata`, `responseFormat`, `cacheControl`, or `thinking` field on `GenerateOptions`.
- **No** `max_tokens` (snake_case) anywhere in `GenerateOptions` — it is `maxTokens`.
- **No** `systemPrompt` field on `GenerateOptions` — it is `system` (a plain string).
- **No** `instructions` field on `GenerateOptions`.
- **No** `systemPromptRegistry` export and **no** `SystemPrompt.register(...)` method in DSH
  0.2.1-rc.2.
- **No** `scope.registry.replace(...)` for services in DSH.
- **No** `maxTokens: 1` / `max_tokens: 1` probe anywhere in DSH.
- **No** `purpose` value other than `'compaction'` and `'session-title'`.
- **No** chunk-shape validator in DSH 0.2.1-rc.2 (the 0.0.1-rc.5 `lib/invariant.js` is gone).
- **No** `usage.input` / `usage.output` / `usage.input_tokens` in the DSH chunk contract — only
  `inputTokens` / `outputTokens` / `totalTokens` / `cacheReadTokens` / `cacheWriteTokens` /
  `reasoningTokens`.

---

## 12. Known limitation — a `complete: true` section discards the shaping section

DSH's `SystemPrompt.assemble()` restores a registered **complete** section as the SOLE section
after the `system-prompt/assemble` waterfall has run:

```js
// SP/lib/index.js (dsh-system-prompt 0.2.1-rc.2)
const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
...
sections: completeSection === void 0 ? transformed.sections : [completeSection],
```

So a plugin that owns the whole system prompt (the `complete` option of `dsh-persona`,
default `false`) makes every section contributed through the waterfall — including this
plugin's `token-saver:prompt-shaping` section — disappear from the rendered prompt.

Verified against the installed `dsh-system-prompt` 0.2.1-rc.2 by registering a `complete`
section next to the shaping injector and rendering the assembly:

```
sectionNames: persona:complete
MARK_IN_RENDERED: false
```

**Status: known limitation, not fixed.** A deployment that owns the whole system prompt owns the
shaping prompt too; this plugin stays silent rather than fighting over the prompt. The default
persona configuration (`complete: false`) is unaffected.
