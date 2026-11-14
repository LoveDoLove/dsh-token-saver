# Documentation

This directory holds the long-form documentation for DSH Token Saver. The root
[README](../README.md) is the short version for first-time visitors. Everything
below is written for people who need to operate, extend, or audit the plugin.

## Start here

| Document | What it answers |
|---|---|
| [Whitepaper](whitepaper.md) | Why the plugin exists, what it believes, and how the pieces fit together |
| [Architecture](architecture.md) | Where the code lives, which DSH extension points it uses, and which invariants hold |
| [Configuration](configuration.md) | Every option, its default, and how settings are stored and served |
| [Tool output compression](tool-output-compression.md) | Head/tail trimming, grep folding, and the RTK filter engine |
| [Prompt shaping](prompt-shaping.md) | Caveman and Ponytail prompt sections, levels, and boundaries |
| [Local responses](local-responses.md) | The five probe shapes answered without a model call |
| [Statistics](statistics.md) | What the dashboard measures, the stats file, and the HTTP API |
| [Compatibility](compatibility.md) | Supported DSH versions and coexistence with other plugins |
| [Development](development.md) | Build, test, package, and release workflow |

## Evidence

| Document | What it contains |
|---|---|
| [Benchmark methodology](benchmark-methodology.md) | How byte-reduction figures are produced and reported |
| [Benchmark results](benchmark-results.md) | Measured figures, workloads, and reproducibility status |
| [LLM stream contract](dsh-llm-stream-contract.md) | Historical note on the frozen request contract and why the plugin no longer rewrites it |

## Chinese

The whitepaper is available in both languages. Operational documents are
English-first and use exact option names and code identifiers, so they stay
usable without translation.

- [Whitepaper (Simplified Chinese)](whitepaper.zh-CN.md)
