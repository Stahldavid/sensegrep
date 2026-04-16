# sensegrep

**Semantic + structural code search for AI-native development.**

[![npm version](https://img.shields.io/npm/v/@sensegrep/core)](https://www.npmjs.com/package/@sensegrep/core)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml/badge.svg)](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml)

sensegrep understands your code semantically. Instead of matching text patterns, it uses AI embeddings and tree-sitter AST parsing to find code by *meaning* - so you can search for "authentication logic" and actually find your auth functions, even if they never contain the word "authentication".

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

# Index your project
sensegrep index --root .

# Search by meaning
sensegrep search "error handling and retry logic" --type function --exported --exclude "*.md"

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

### MCP Server (for Windsurf or manual setup)

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

The MCP server provides `sensegrep.search`, `sensegrep.index`, and `sensegrep.detect_duplicates` tools.

### VS Code Extension

Search for **"Sensegrep"** in the VS Code marketplace, or install from [the extension page](https://marketplace.visualstudio.com/items?itemName=sensegrep.sensegrep).

Features: semantic search sidebar, duplicate detection, code lens, semantic folding, auto-indexing with watch mode.

## Recipes

Copy-paste setup and practical workflows:

- [Claude Code recipe](docs/recipes/claude-code.md)
- [Cursor recipe](docs/recipes/cursor.md)
- [Windsurf recipe](docs/recipes/windsurf.md)
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
│  AST Parser  │    │  (symbols +  │    │ (Gemini or   │
│              │    │   metadata)  │    │ OpenAI-comp) │
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
3. **Embed**: Each chunk is embedded using Gemini or an OpenAI-compatible embeddings API.
4. **Store**: Embeddings + metadata are stored in LanceDB for fast vector search
5. **Search**: Your query is embedded and matched against the index with optional structural filters
6. **Tree-shake**: Results are collapsed to show only relevant code, hiding unrelated symbols

## Supported Languages

- **TypeScript** / **JavaScript** (TSX/JSX included)
- **Python** (dataclasses, protocols, decorators, async generators, TypedDict, and more)
- More coming: C#, Java, HTML (see [feature branches](https://github.com/Stahldavid/sensegrep/branches))

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
```

## Embeddings Configuration

sensegrep uses remote embedding providers: Gemini or OpenAI-compatible APIs.

```bash
# Recommended: Gemini embeddings (best quality)
export GEMINI_API_KEY="your_ai_studio_key"
sensegrep search "auth flow" --provider gemini --embed-model gemini-embedding-001

# OpenAI-compatible provider
export SENSEGREP_OPENAI_API_KEY="your_api_key"
sensegrep search "auth flow" --provider openai --embed-model fireworks/qwen3-embedding-8b
```

Global defaults via `~/.config/sensegrep/config.json`:

```json
{
  "provider": "gemini",
  "embedModel": "gemini-embedding-001",
  "embedDim": 768
}
```

Common environment variables:

- `SENSEGREP_PROVIDER` (`gemini`, `openai`)
- `SENSEGREP_EMBED_MODEL`
- `SENSEGREP_EMBED_DIM`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` (Gemini)
- `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` / `OPENAI_API_KEY` (OpenAI-compatible)
- `SENSEGREP_ROOT` (MCP root directory)
- `SENSEGREP_WATCH` (MCP watcher toggle)

For the complete and official runtime variable list, see `docs/mcp-setup.md`.

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

## Case Studies

Reproducible qualitative examples from public repositories:

- [Case studies](docs/case-studies.md)

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
