# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this repository is

`dsh-token-saver` is a DeepSeek Harness (DSH) plugin bundle. It reduces the text
a model reads by compacting tool output, folding grep results, optionally shaping
the system prompt, and answering a few well-identified requests locally. It is a
TypeScript package with a browser client, a Cordis bundle patch, and display
resources.

Read these before changing behavior:

- [docs/architecture.md](docs/architecture.md) — entry points, data flow, invariants
- [docs/configuration.md](docs/configuration.md) — every option and default
- [docs/development.md](docs/development.md) — commands, layout, release checklist
- [docs/whitepaper.md](docs/whitepaper.md) — design rationale

## Ground rules

- **Trimming is the only default-on optimization.** The default `conservative`
  mode trims and folds tool output. RTK, prompt shaping, local responses, and
  pressure compaction are opt-in.
- **Never compact errors.** `result.isError` returns unchanged.
- **Strictly smaller or unchanged.** Accept a compaction only when the output is
  non-empty and smaller than the original.
- **Fail open.** A strategy error returns the upstream decision. Never throw into
  a request path.
- **Bytes, not tokens.** Report and document UTF-8 bytes. Do not claim token
  counts.
- **One export form.** `src/index.ts` exports `name`, `Config`, `inject`, and
  `apply`. Do not add a default export or a service-class export.
- **Supported DSH seams only.** Prompt text goes through
  `ctx.systemPrompt.section()`. Do not listen to `system-prompt/assemble` to add
  text. Do not mutate the frozen `llm/stream` request. Do not mutate the service
  registry to replace a provider.
- **No new dependencies without a reason.** Prefer the standard library and
  existing modules.

## Where things live

| Change | File |
|---|---|
| Plugin entry, hook wiring | `src/index.ts` |
| Options, defaults, validation | `src/config.ts` |
| Post-execute decision | `src/strategies/tool-result-trim.ts` |
| Pre-step pressure decision | `src/strategies/context-pressure.ts` |
| Byte truncation | `src/lib/truncate.ts` |
| Grep folding | `src/lib/fold-grep.ts` |
| RTK filters | `src/rtk/filters/*.ts`, registered in `src/rtk/registry.ts` |
| Prompt shaping text | `src/prompt-shaping/prompts.ts` |
| Local request detectors | `src/local-responses/detectors.ts` |
| Settings persistence | `src/settings.ts` |
| Stats persistence | `src/stats-store.ts` |
| HTTP API | `src/routes.ts` |
| Web panel | `client.js` |
| Display metadata | `locale/en.json`, `locale/zh.json`, `icon.svg` |
| Package verification | `scripts/verify-package.mjs` |

## Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:package
pnpm prepack     # all of the above in release order
```

`lib/` is generated and gitignored. Never edit it by hand.

## Testing expectations

- Add or update a Vitest case for every behavior change.
- Keep the existing suites green. `pnpm prepack` is the gate.
- Test the decision function directly for strategy changes, and the mock scope
  for wiring changes.
- Do not assert on log text unless the log line is the contract.

## Documentation rules

- Root README is a short entry point. Detail belongs in `docs/`.
- Keep the English and Chinese READMEs and whitepapers in sync.
- When a feature is not wired, say so. Do not describe an export as an active
  feature.
- Update `docs/configuration.md` when adding an option.
- Update `docs/development.md` when adding a command, module, or filter.

## DSH compatibility

The bundle targets `engines.dsh >=0.2.0 <0.3.0` and Node `>=22.19.0`. Before
relying on a DSH API, check the installed DSH package types under
`node_modules/@deepseek-ai/dsh-*` or the DSH documentation. Do not assume an API
exists because a name looks plausible.

## Committing

- Do not commit unless asked.
- Keep commits focused and use an imperative subject.
- Run `pnpm prepack` before a release commit.
