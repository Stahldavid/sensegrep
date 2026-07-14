# sensegrep

**semantic grep for AI coding agents**

[![npm version](https://img.shields.io/npm/v/@sensegrep/core)](https://www.npmjs.com/package/@sensegrep/core)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml/badge.svg)](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml)

sensegrep understands your code semantically. Instead of matching text patterns, it uses AI embeddings and tree-sitter AST parsing to find code by *meaning* - so you can search for "authentication logic" and actually find your auth functions, even if they never contain the word "authentication".

AI agents should not read more code, they should read the right code. sensegrep combines semantic search, exact matching, and AST-aware structural retrieval to deliver smaller, more relevant context.

![Sensegrep time-to-value demo](assets/time-to-value.gif)

MP4 fallback: [assets/time-to-value.mp4](assets/time-to-value.mp4)

Watch full product demo (25s): [assets/time-to-value-full.mp4](assets/time-to-value-full.mp4)

## Why sensegrep?

Traditional search tools (grep, ripgrep, ast-grep) match **text patterns**. sensegrep matches **concepts**:

| Feature | grep/ripgrep | ast-grep | sensegrep |
|---------|-------------|----------|-----------|
| Exact text match | Yes | Yes | Yes (via `--pattern`) |
| AST-aware | No | Yes | Yes (tree-sitter) |
| Semantic search | No | No | **Yes (AI embeddings)** |
| Symbol metadata filters | No | Partial | **Yes (30+ filters)** |
| Duplicate detection | No | No | **Yes (logical duplicates)** |
| Tree-shaking output | No | No | **Yes (collapse irrelevant code)** |
| MCP server for AI agents | No | No | **Yes** |

## Quickstart

### Claude Code Plugin (recommended)

The fastest way to get sensegrep into Claude Code — zero configuration:

```bash
claude plugin marketplace add Stahldavid/sensegrep
claude plugin install sensegrep
```

This automatically sets up the MCP server and teaches Claude when and how to use sensegrep instead of grep. No manual JSON editing required.

> **Marketplace setup** (required on first install):
> ```bash
> claude plugin marketplace add Stahldavid/sensegrep
> claude plugin install sensegrep
> ```
>
> After the marketplace has been added once, the explicit marketplace form also works:
> ```bash
> claude plugin install sensegrep@sensegrep
> ```
>
> Running `claude plugin install sensegrep@sensegrep` on a fresh machine before `claude plugin marketplace add Stahldavid/sensegrep` will fail because Claude Code does not know the `sensegrep` marketplace yet.

### CLI

```bash
npm i -g @sensegrep/cli

# Smoke-test local CLI/core/config without calling embeddings
sensegrep selftest --root .

# Default local embeddings use Ollama when no API key/provider is configured
ollama pull qwen3-embedding:0.6b
sensegrep index --root .

# Search by meaning
sensegrep search "error handling and retry logic" --type function --exported --exclude "*.md"

# Deterministic and exhaustive: no embedding call
sensegrep literal "X-Goog-Message-Number" --include "src/**"

# Compact evidence cards, followed by deterministic expansion
sensegrep search "authentication flow" --purpose understand --json
sensegrep show <result-id> --before 10 --after 20

# Exhaustive within the ripgrep-visible filesystem, independent of the index
sensegrep literal "TODO:" --filesystem --max-output-bytes 50000 --json

# Complete changed-file review coverage in bounded batches
sensegrep audit "security regressions" --base origin/main --require-coverage --continue-uncovered --batch-tokens 4000 --max-total-tokens 8000 --max-output-bytes 32000 --max-batches 8

# Build a reading map for a broad theme
sensegrep survey "authentication login token" --language typescript --limit 4

# Break a broad topic into coherent subthemes
sensegrep cluster "checkout payment order cart" --limit 4

# Find duplicates
sensegrep detect-duplicates --threshold 0.85
sensegrep detect-duplicates --threshold 0.85 --timeout 30s --resume-cursor 0 --json
```

Agent-facing JSON is minified and `minimal` by default. Opt into `--json-detail content`,
`--diagnostic`, `--json-detail full`, or `--pretty` only when that additional payload is needed.
Schema v2 uses one card vocabulary across transports: `id`, `file`, `lines`, `symbol`,
`kind`, `rank`, and `relevance`. Minimal output keeps retrieval sufficiency, compact index
state, and structured warnings; budgets appear only when constrained. Physical output
budgets apply to the final serialized JSON and retain a partial evidence card when possible.
Duplicate JSON excludes source code unless `--show-code` is supplied. Survey and cluster
JSON default to actionable summary mode with representative IDs.

### Cursor Plugin

Install from the Cursor marketplace or via CLI:

```bash
cursor plugin install sensegrep
```

Includes the MCP server, an always-on rule to prefer sensegrep over grep, and a skill with full filter reference.
Cursor plugin status: pending marketplace approval.

One-click MCP install link for Cursor:

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-111111?logoColor=white)](https://stahldavid.github.io/sensegrep/cursor-install/)

Fallback deeplink (copy/paste if needed):

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=sensegrep&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzZW5zZWdyZXAvbWNwQGxhdGVzdCJdfQ%3D%3D
```

### Codex Plugin

Install from the public marketplace — no manual config:

```bash
codex plugin marketplace add Stahldavid/sensegrep
codex plugin install sensegrep
```

See the [Codex recipe](docs/recipes/codex.md) for the manual `~/.codex/config.toml` setup.

### MCP Server (for Codex or manual setup)

```bash
npx -y @sensegrep/mcp
```

Add to your MCP configuration:

```json
{
  "servers": {
    "sensegrep": {
      "command": "npx",
      "args": ["-y", "@sensegrep/mcp"]
    }
  }
}
```

Or with `npm` global install first:

```bash
npm install -g @sensegrep/mcp
```

```json
{
  "servers": {
    "sensegrep": {
      "command": "sensegrep-mcp"
    }
  }
}
```

The MCP server provides canonical `sensegrep_search`, `sensegrep_show`, `sensegrep_literal`, `sensegrep_context`, `sensegrep_survey`, `sensegrep_cluster`, `sensegrep_graph`, `sensegrep_index`, and `sensegrep_detect_duplicates` tools. Legacy dotted names such as `sensegrep.search` remain available as compatibility aliases where supported.

### Agent Skill — CLI (no MCP server)

For terminal-first agents or CI, you don't need an MCP server. Install the CLI and the
`sensegrep-cli` [Agent Skill](docs/agent-skills.md), which teaches the agent to run
`sensegrep` commands directly:

```bash
npm i -g @sensegrep/cli
npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g
```

See [docs/agent-skills.md](docs/agent-skills.md) for when to use the MCP tools vs the CLI skill.

### VS Code Extension

Search for **"Sensegrep"** in the VS Code marketplace, or install from [the extension page](https://marketplace.visualstudio.com/items?itemName=sensegrep.sensegrep).

Features: semantic search sidebar, duplicate detection, code lens, semantic folding, and multi-root auto-indexing/watch mode.

## Recipes

Copy-paste setup and practical workflows:

- [Claude Code recipe](docs/recipes/claude-code.md)
- [Cursor recipe](docs/recipes/cursor.md)
- [Codex recipe](docs/recipes/codex.md)
- [CI with GitHub Actions](docs/recipes/ci-github-actions.md)
- [Generic CI recipe](docs/recipes/ci-generic.md)

Full index: [docs/recipes/README.md](docs/recipes/README.md)

## How It Works

```
Source Code
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  Tree-Sitter │───▶│   Chunker    │───▶│  Embeddings  │
│  AST Parser  │    │  (symbols +  │    │ (Ollama,     │
│              │    │   metadata)  │    │ Gemini, etc.)│
└─────────────┘    └──────────────┘    └──────────────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                          Query ──────▶│   LanceDB    │
                                       │ Vector Search│
                                       └──────┬───────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │ Tree-Shaker  │──▶ Results
                                       │ (collapse    │
                                       │  irrelevant) │
                                       └──────────────┘
```

1. **Parse**: Tree-sitter extracts AST nodes with full metadata (symbol type, exports, complexity, docs, decorators)
2. **Chunk**: Code is split into semantic chunks aligned to symbol boundaries
3. **Embed**: Each chunk is embedded using Ollama, Gemini, an OpenAI-compatible embeddings API, or Amazon Bedrock.
4. **Store**: Embeddings + metadata are stored in LanceDB for fast vector search
5. **Search**: Vector and lexical candidates are fused, structurally filtered, and optionally reranked
6. **Tree-shake**: Results are collapsed to show only relevant code, hiding unrelated symbols

## Supported Languages

- **TypeScript** / **JavaScript** (TSX/JSX included)
- **Python** (dataclasses, protocols, decorators, async generators, TypedDict, and more)
- **Java** (classes, interfaces, records, annotations, methods, and tree-shaken results)
- **Vue** (single-file components with `<script>` / `<script setup>` semantic support)
- More coming: C#, HTML (see [feature branches](https://github.com/Stahldavid/sensegrep/branches))

## Search Filters

sensegrep supports 30+ structural filters that can be combined with semantic search:

```bash
# Find exported async functions with high complexity
sensegrep search "data processing" --type function --exported --async --min-complexity 5

# Find Python dataclasses
sensegrep search "user model" --type class --variant dataclass --language python

# Find undocumented complex code (refactoring candidates)
sensegrep search "business logic" --min-complexity 10 --has-docs false

# Filter by decorator
sensegrep search "route handler" --type function --decorator route

# Keep docs and markdown out of results
sensegrep search "authentication flow" --include "src/**/*.ts" --exclude "*.md"

# Build a reading map for onboarding a domain
sensegrep survey "authentication login token" --language typescript --limit 4

# Split a broad backend topic into subthemes
sensegrep cluster "price list commission ncm uf packaging" --language java --include "backend-api/**/*.java"

# Build an agent context pack with a hard estimated-token budget
sensegrep context "authentication request flow" --max-tokens 8000

# Review only code changed against a Git base
sensegrep audit "security and regression risks" --base origin/main

# Navigate the local symbol graph
sensegrep references loadUser
sensegrep impact loadUser --depth 3
sensegrep trace handleRequest loadUser
```

Graph nodes use canonical file/range identities. Ambiguous same-name call targets are omitted instead of expanded into speculative impact edges.

## Index Operations

```bash
# Inspect local work before any embedding request
sensegrep index --dry-run --no-watch

# Interrupted full builds resume their fingerprint-matched staging table
sensegrep index --full --no-watch

# Compare safe concurrency candidates without changing saved config
sensegrep benchmark --concurrency 1,2,4 --samples 16

# Keep independent indexes for different models/settings
sensegrep index --profile fast --no-watch
sensegrep profiles

# Keep LanceDB, graph, tools, and watcher warm behind a local HTTP endpoint
sensegrep daemon start
sensegrep daemon endpoint
sensegrep daemon call --tool search --arguments '{"query":"request routing","limit":5}'

# Agent-native planning and task-level quality evaluation
sensegrep investigate "where does payment gate room access?" --dry-run
sensegrep eval sensegrep-eval.yaml
```

Diagnostic commands are strictly read-only. An incompatible index reports `migrationRequired: true`; rebuild it with `sensegrep index migrate --no-watch`. Full builds stage and validate a new Lance table before switching metadata, while prior generations are retained for concurrent readers and rollback diagnostics.

Changed files reuse vectors for content-identical chunks, even when neighboring chunks or metadata changed. Full indexes checkpoint staging tables and skip IDs already persisted after a restart. For large indexes, LanceDB ANN and scalar indexes are created automatically at 10,000 chunks; set `SENSEGREP_ANN_MIN_CHUNKS=0` to disable or choose another threshold.

### Language plugins

Language support can be extended without modifying core. A plugin exports a `LanguageSupport` object (default, `language`, or `languages[]`) with its extensions and optional `chunk(content, filePath)` implementation. Add project-relative ESM modules or package names to `languagePlugins` in `sensegrep.config.json`, or set `SENSEGREP_LANGUAGE_PLUGINS` to a comma-separated list.

```json
{
  "languagePlugins": ["./tools/sensegrep-ruby.mjs"]
}
```

## Embeddings Configuration

sensegrep supports local Ollama by default plus Gemini, OpenAI-compatible APIs, and Amazon Bedrock. If no API key or provider is configured, it defaults to Ollama at `http://127.0.0.1:11434` with `qwen3-embedding:0.6b` (1024 dimensions, 32K context). Run `sensegrep selftest --root .` before indexing to confirm the selected provider/model/dimension and credential/endpoint guidance without making embedding calls.

```bash
# Default local Ollama embeddings (no API key)
ollama pull qwen3-embedding:0.6b
sensegrep search "auth flow"

# Recommended: Gemini embeddings (best quality)
export SENSEGREP_PROVIDER=gemini
export GEMINI_API_KEY="your_ai_studio_key"
sensegrep search "auth flow" --provider gemini --embed-model gemini-embedding-001

# OpenAI-compatible provider
export SENSEGREP_PROVIDER=openai
export SENSEGREP_OPENAI_API_KEY="your_api_key"
export SENSEGREP_OPENAI_BASE_URL="https://api.fireworks.ai/inference/v1"
sensegrep search "auth flow" --provider openai --embed-model fireworks/qwen3-embedding-8b

# OpenRouter + Qwen3 Embedding 8B with smaller Matryoshka vectors
export SENSEGREP_PROVIDER=openai
export SENSEGREP_OPENAI_API_KEY="your_openrouter_key"
export SENSEGREP_OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export SENSEGREP_EMBED_MODEL="qwen/qwen3-embedding-8b"
export SENSEGREP_EMBED_DIM=1024
export SENSEGREP_OPENAI_BATCH_SIZE=96

# Amazon Bedrock + Cohere Embed v4
export AWS_REGION="us-east-1"
export SENSEGREP_BEDROCK_API_KEY="your_bedrock_api_key"
sensegrep search "auth flow" --provider bedrock --embed-model cohere.embed-v4:0 --embed-dim 1536
```

Local OpenAI-compatible embedding servers also work if they implement `/v1/embeddings`; set `SENSEGREP_PROVIDER=openai`, `SENSEGREP_OPENAI_BASE_URL` to the server's `/v1` base URL, and `SENSEGREP_EMBED_DIM` to the exact returned vector dimension. For native Ollama, use `SENSEGREP_PROVIDER=ollama`, `SENSEGREP_OLLAMA_BASE_URL` if not using the default, and the exact `SENSEGREP_EMBED_DIM` for your Ollama model.

Global defaults via `~/.config/sensegrep/config.json`:

```json
{
  "provider": "ollama",
  "embedModel": "qwen3-embedding:0.6b",
  "embedDim": 1024
}
```

Common environment variables:

- `SENSEGREP_PROVIDER` (`ollama`, `gemini`, `openai`, `bedrock`)
- `SENSEGREP_EMBED_MODEL`
- `SENSEGREP_EMBED_DIM`
- `SENSEGREP_OLLAMA_BASE_URL` (Ollama, default `http://127.0.0.1:11434`)
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` (Gemini)
- `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` / `OPENAI_API_KEY` (OpenAI-compatible)
- `SENSEGREP_OPENAI_BASE_URL` (OpenAI-compatible, default `https://api.fireworks.ai/inference/v1`)
- `SENSEGREP_OPENAI_BATCH_SIZE` (OpenAI-compatible request batch size)
- `SENSEGREP_OPENAI_CONCURRENCY` / `SENSEGREP_EMBED_CONCURRENCY` (provider request concurrency)
- `SENSEGREP_INDEX_EMBED_CONCURRENCY` (concurrent index embedding batches)
- `SENSEGREP_QUERY_CACHE` (`true` by default; set `false` for controlled benchmarks or sensitive environments)
- `SENSEGREP_QUERY_CACHE_TTL_MS` / `SENSEGREP_QUERY_CACHE_MAX_ENTRIES` (persistent query-vector cache bounds)
- `SENSEGREP_ADAPTIVE_HYBRID_DELAY_MS` / `SENSEGREP_ADAPTIVE_HYBRID_MIN_SCORE` (adaptive hybrid tuning)
- `SENSEGREP_ANN_MIN_CHUNKS` (automatic ANN threshold; `0` disables)
- `SENSEGREP_PROFILE` (named side-by-side index profile)
- `SENSEGREP_LANGUAGE_PLUGINS` (comma-separated ESM language plugins)
- `SENSEGREP_OPENROUTER_REFERER` / `SENSEGREP_OPENROUTER_TITLE` (optional OpenRouter attribution headers)
- `SENSEGREP_BEDROCK_API_KEY` (Amazon Bedrock bearer API key; omit when using the AWS SDK credential chain)
- `SENSEGREP_BEDROCK_REGION` / `AWS_REGION` / `AWS_DEFAULT_REGION` (Amazon Bedrock)
- `SENSEGREP_ROOT` (MCP root directory)
- `SENSEGREP_WATCH` (MCP watcher toggle)

For the complete and official runtime variable list, see `docs/mcp-setup.md`.

OpenRouter Qwen embeddings use one provider request at a time by default. Benchmarking on
high-latency endpoints commonly shows that additional concurrent requests reduce throughput;
use `sensegrep benchmark --concurrency 1,2,4 --json` before overriding the default.

### Index compatibility

Each index records the embedding provider, model, dimension, distance metric, and a non-secret endpoint/configuration fingerprint. If you change provider, model, base URL, dimension, local server pooling behavior, or task-prefix strategy, rebuild the index with `sensegrep index --root . --full --no-watch`. Same dimension does **not** make embeddings interchangeable; two 768-dimensional models still produce different vector spaces.

More embedding providers and API integrations may be added in the future.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@sensegrep/core](packages/core) | Search engine library | [![npm](https://img.shields.io/npm/v/@sensegrep/core)](https://www.npmjs.com/package/@sensegrep/core) |
| [@sensegrep/cli](packages/cli) | Command-line interface | [![npm](https://img.shields.io/npm/v/@sensegrep/cli)](https://www.npmjs.com/package/@sensegrep/cli) |
| [@sensegrep/mcp](packages/mcp) | MCP server for AI agents | [![npm](https://img.shields.io/npm/v/@sensegrep/mcp)](https://www.npmjs.com/package/@sensegrep/mcp) |
| [sensegrep](packages/vscode) | VS Code extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=sensegrep.sensegrep) |
| [sensegrep-plugin](plugin/sensegrep-plugin) | Claude Code plugin | `claude plugin marketplace add Stahldavid/sensegrep && claude plugin install sensegrep` |
| [sensegrep-cursor](plugin/sensegrep-cursor) | Cursor plugin | `cursor plugin install sensegrep` |
| [sensegrep (Codex)](plugins/sensegrep) | Codex plugin | `codex plugin marketplace add Stahldavid/sensegrep && codex plugin install sensegrep` |

## Case Studies

Reproducible qualitative examples from public repositories:

- [Case studies](docs/case-studies.md)
- [Use cases](docs/use-cases.md)
- [Parallel-agent workflows](docs/parallel-agents.md)

## Roadmap

- [ROADMAP.md](ROADMAP.md)
- Benchmark methodology vs `ripgrep` / `ast-grep` is scheduled for Month 2.

## Contributing

See [the architecture guide](docs/architecture.md) for runtime and persistence design, and [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines. The VS Code extension stores provider API keys in VS Code `SecretStorage`; workspace settings contain only non-secret configuration.

## Community

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## License

[Apache-2.0](LICENSE)
