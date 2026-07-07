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
ollama pull nomic-embed-text:v1.5
sensegrep index --root .

# Search by meaning
sensegrep search "error handling and retry logic" --type function --exported --exclude "*.md"

# Build a reading map for a broad theme
sensegrep survey "authentication login token" --language typescript --limit 4

# Break a broad topic into coherent subthemes
sensegrep cluster "checkout payment order cart" --limit 4

# Find duplicates
sensegrep detect-duplicates --threshold 0.85
```

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

The MCP server provides canonical `sensegrep_search`, `sensegrep_survey`, `sensegrep_cluster`, `sensegrep_index`, and `sensegrep_detect_duplicates` tools. Legacy dotted names such as `sensegrep.search` remain available as compatibility aliases where supported.

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

Features: semantic search sidebar, duplicate detection, code lens, semantic folding, auto-indexing with watch mode.

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
5. **Search**: Your query is embedded and matched against the index with optional structural filters
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
```

## Embeddings Configuration

sensegrep supports local Ollama by default plus Gemini, OpenAI-compatible APIs, and Amazon Bedrock. If no API key or provider is configured, it defaults to Ollama at `http://127.0.0.1:11434` with `nomic-embed-text:v1.5` (768 dimensions). Run `sensegrep selftest --root .` before indexing to confirm the selected provider/model/dimension and credential/endpoint guidance without making embedding calls.

```bash
# Default local Ollama embeddings (no API key)
ollama pull nomic-embed-text:v1.5
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

# Experimental fastembed-rs sidecar for Jina code embeddings
export SENSEGREP_PROVIDER=fastembed
export SENSEGREP_FASTEMBED_BASE_URL="http://127.0.0.1:11435/v1"
sensegrep search "auth flow" --provider fastembed --embed-model jinaai/jina-embeddings-v2-base-code --embed-dim 768

# Amazon Bedrock + Cohere Embed v4
export AWS_REGION="us-east-1"
sensegrep search "auth flow" --provider bedrock --embed-model cohere.embed-v4:0 --embed-dim 1536
```

Local OpenAI-compatible embedding servers also work if they implement `/v1/embeddings`; set `SENSEGREP_PROVIDER=openai`, `SENSEGREP_OPENAI_BASE_URL` to the server's `/v1` base URL, and `SENSEGREP_EMBED_DIM` to the exact returned vector dimension. For native Ollama, use `SENSEGREP_PROVIDER=ollama`, `SENSEGREP_OLLAMA_BASE_URL` if not using the default, and the exact `SENSEGREP_EMBED_DIM` for your Ollama model. For the experimental fastembed-rs sidecar, use `SENSEGREP_PROVIDER=fastembed` and `SENSEGREP_FASTEMBED_BASE_URL`; initial support is intentionally limited to `jinaai/jina-embeddings-v2-base-code` at 768 dimensions. See [docs/fastembed-rs-sidecar.md](docs/fastembed-rs-sidecar.md).

Global defaults via `~/.config/sensegrep/config.json`:

```json
{
  "provider": "ollama",
  "embedModel": "nomic-embed-text:v1.5",
  "embedDim": 768
}
```

Common environment variables:

- `SENSEGREP_PROVIDER` (`ollama`, `fastembed`, `gemini`, `openai`, `bedrock`)
- `SENSEGREP_EMBED_MODEL`
- `SENSEGREP_EMBED_DIM`
- `SENSEGREP_OLLAMA_BASE_URL` (Ollama, default `http://127.0.0.1:11434`)
- `SENSEGREP_FASTEMBED_BASE_URL` (experimental fastembed-rs sidecar, default `http://127.0.0.1:11435/v1`)
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` (Gemini)
- `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` / `OPENAI_API_KEY` (OpenAI-compatible)
- `SENSEGREP_BEDROCK_REGION` / `AWS_REGION` / `AWS_DEFAULT_REGION` (Amazon Bedrock)
- `SENSEGREP_ROOT` (MCP root directory)
- `SENSEGREP_WATCH` (MCP watcher toggle)

For the complete and official runtime variable list, see `docs/mcp-setup.md`.

### Index compatibility

Each index records the embedding provider, model, dimension, and distance metric used to create it. If you change provider, model, base URL, dimension, local server pooling behavior, or task-prefix strategy, rebuild the index with `sensegrep index --root . --full --no-watch`. Same dimension does **not** make embeddings interchangeable; two 768-dimensional models still produce different vector spaces.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and contribution guidelines.

## Community

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## License

[Apache-2.0](LICENSE)
