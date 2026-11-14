# Development

## Requirements

- Node.js `>=22.19.0`
- pnpm
- A DSH checkout only when you want to test against a live Host

## Commands

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm lint          # oxlint src test
pnpm test          # vitest run
pnpm build         # tsc -p tsconfig.build.json, emits lib/
pnpm verify:package
```

`pnpm prepack` runs lint, typecheck, test, build, and `verify:package` in order.
CI runs the same chain on Node 22 with a frozen lockfile.

`lib/` is a build artifact and is gitignored. The `prepare` script builds it on
install, so a git-URL install needs approval to run install scripts. The `.tgz`
release artifact is the alternative when scripts cannot run.

## Repository layout

```
src/                 TypeScript source, compiled to lib/
client.js            Web client, loaded by the DSH client module loader
cordis.patch.yml     Bundle patch that inserts the plugin row
locale/              Display metadata (en.json, zh.json)
icon.svg             Plugin icon
scripts/             verify-package.mjs
test/                Vitest suites
docs/                Long-form documentation
```

## What verify:package checks

`scripts/verify-package.mjs` fails the build when:

- a declared `main`, `module`, `types`, or `exports` target is missing;
- a source module has no compiled output;
- a filter exists but is not registered;
- locale metadata is missing or empty;
- the icon is missing, the wrong type, or larger than 256 KiB;
- the locale or icon exports are absent;
- `files` omits runtime files or display resources.

Run it after changing `package.json`, adding a module, or adding a filter.

## Test layout

| Suite | Covers |
|---|---|
| `plugin.test.ts` | Entry point, config validation, hook registration |
| `compatibility.test.ts` | DSH contract shapes and pass-through behavior |
| `smoke-local.test.ts` | End-to-end wiring with a mock scope |
| `tool-result-trim.test.ts` | Trimming decisions and content rebuild |
| `fold-grep.test.ts` | Match folding and context |
| `truncate.test.ts` | Byte budgets and line boundaries |
| `rtk.test.ts` | Filters, autodetection, and guards |
| `prompt-shaping.test.ts` | Level text and boundaries |
| `local-responses.test.ts` | Detector conditions and synthetic stream |
| `context-pressure.test.ts` | Threshold decisions |
| `settings-and-routes.test.ts` | Settings merge and HTTP API |
| `stats-store.test.ts` | Persistence and counter semantics |
| `client-registration.test.ts` | Client factory and slot registration |
| `llm-summary.test.ts`, `prompt-cache.test.ts`, `plugin-stats.test.ts` | Exported helpers and telemetry |

## Changing behavior

- A new option goes in `src/config.ts`, gets a default, a validator entry, and a
  row in [configuration](configuration.md).
- A new filter goes in `src/rtk/filters/`, gets registered in
  `src/rtk/registry.ts`, and gets a `verify:package` pass.
- A new local probe goes in `src/local-responses/detectors.ts`, is added to
  `OPTIMIZATIONS`, and must prove it cannot match an ordinary message.
- A new DSH hook must be a supported extension point. Do not add a
  `system-prompt/assemble` listener to add text and do not mutate the
  `llm/stream` request.

## Release checklist

1. Update the version in `package.json`.
2. Update the changelog section of the README if behavior changed.
3. Run `pnpm prepack`.
4. Inspect the packed file list with `npm pack --dry-run`.
5. Tag the release and attach the `.tgz`.
6. Keep the pinned install command in the README in sync with the tag.

## Documentation rules

- Measure bytes, not tokens.
- State what is not wired. Do not describe the exported LLM-summary engine as an
  active feature.
- Keep the root README short. Put detail in `docs/`.
- Use exact option names and code identifiers.
