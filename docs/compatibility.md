# Compatibility

## Versions

| Requirement | Range |
|---|---|
| DeepSeek Harness | `>=0.2.0 <0.3.0` |
| Node.js | `>=22.19.0` |
| Cordis | `>=4.0.0 <5.0.0` |
| dsh-compaction | `>=0.0.1-rc.1 <0.3.0` |

`engines.dsh` is the authoritative check. DSH refuses to install or start the
bundle when the running version is outside the range. Without that field, DSH
falls back to the `@deepseek-ai/dsh*` peer dependency ranges.

The plugin is developed against DSH 0.2.2-rc.3. A change to DSH's tool,
system-prompt, or LLM stream contracts can require a matching plugin update.

## Official plugin structure

The bundle follows the documented DSH plugin shape:

- One export form. The package exports `name`, `Config`, `inject`, and `apply`,
  and no default export.
- `Config` implements the Standard Schema interface through `~standard`.
  Invalid values fail activation.
- Required service `tools` is declared in `inject`. Optional services
  (`webServer`, `systemPrompt`) are resolved with `ctx.inject`, and
  `tokenMeter`, `compaction`, and `agents` are read lazily.
- Prompt text is contributed with `ctx.systemPrompt.section()`, not by listening
  to `system-prompt/assemble`.
- The frozen `llm/stream` request is never mutated.
- Compaction providers are not replaced at runtime.
- Display resources ship in the package: `locale/en.json`, `locale/zh.json`,
  `icon.svg`, the `./locale/*.json` and `./icon` exports, and entries in
  `files`.
- The bundle declares `dsh.bundle.patch` and ships `cordis.patch.yml`.

## Coexistence

**Billion Context.** ACP-marked content is preserved by the relevant output
filter. The plugin does not strip markers it does not own.

**OmniRoute.** Request routing fields are read-only to this plugin and remain
intact.

**Our Free Model.** Detects the `<!-- ofm-token-saver -->` marker and skips its
own prompt shaping, so shaping is not applied twice.

Compatibility depends on the versions and configuration of the surrounding
plugins. Report reproducible issues with the DSH version, plugin versions, and a
minimal configuration.

## Known limits

- Byte figures are not token counts.
- RTK filters are lossy by design. Read-like tools skip autodetection.
- The exported LLM-summary engine is not wired into DSH's compaction seam. A
  host that wants it must select a provider in `cordis.yml`.
- `replaceBasicCompaction` logs a warning and changes nothing.
- `cacheStableSections` is retained for API compatibility and is not applied.
