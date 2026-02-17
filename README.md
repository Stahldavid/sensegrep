# sensegrep

**Semantic + structural code search for AI-native development.**

[![npm version](https://img.shields.io/npm/v/@sensegrep/core)](https://www.npmjs.com/package/@sensegrep/core)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml/badge.svg)](https://github.com/Stahldavid/sensegrep/actions/workflows/ci.yml)

sensegrep understands your code semantically. Instead of matching text patterns, it uses AI embeddings and tree-sitter AST parsing to find code by *meaning* - so you can search for "authentication logic" and actually find your auth functions, even if they never contain the word "authentication".

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

### CLI

```bash
npm i -g @sensegrep/cli

# Index your project
sensegrep index --root .

# Search by meaning
sensegrep search "error handling and retry logic" --type function --exported

# Find duplicates
sensegrep detect-duplicates --threshold 0.85
```

### MCP Server (for Claude Code, Cursor, Windsurf, etc.)

```bash
npm i -g @sensegrep/mcp
```

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "sensegrep": {
      "command": "sensegrep-mcp",
      "env": {
        "SENSEGREP_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

The MCP server provides `sensegrep.search`, `sensegrep.index`, `sensegrep.stats`, `sensegrep.detect_duplicates`, and `sensegrep.languages` tools.

### VS Code Extension

Search for **"Sensegrep"** in the VS Code marketplace, or install from [the extension page](https://marketplace.visualstudio.com/items?itemName=sensegrep.sensegrep).

Features: semantic search sidebar, duplicate detection, code lens, semantic folding, auto-indexing with watch mode.

## How It Works

```
Source Code
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  Tree-Sitter │───▶│   Chunker    │───▶│  Embeddings  │
│  AST Parser  │    │  (symbols +  │    │  (local or   │
│              │    │   metadata)  │    │   Gemini)    │
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
3. **Embed**: Each chunk is embedded using local models (HuggingFace transformers.js) or Gemini API
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
```

## Embeddings Configuration

sensegrep supports local (default) and Gemini embeddings:

```bash
# Local (default) - no API key needed
sensegrep search "auth flow" --device cpu

# Gemini API
sensegrep search "auth flow" --provider gemini --embed-model gemini-embedding-001

# Custom local model
sensegrep search "auth flow" --embed-model BAAI/bge-base-en-v1.5 --embed-dim 768
```

Global defaults via `~/.config/sensegrep/config.json`:

```json
{
  "provider": "local",
  "embedModel": "BAAI/bge-small-en-v1.5",
  "embedDim": 384,
  "device": "cpu"
}
```

Environment variables: `SENSEGREP_PROVIDER`, `SENSEGREP_EMBED_MODEL`, `SENSEGREP_EMBED_DIM`, `SENSEGREP_EMBED_DEVICE`.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@sensegrep/core](packages/core) | Search engine library | [![npm](https://img.shields.io/npm/v/@sensegrep/core)](https://www.npmjs.com/package/@sensegrep/core) |
| [@sensegrep/cli](packages/cli) | Command-line interface | [![npm](https://img.shields.io/npm/v/@sensegrep/cli)](https://www.npmjs.com/package/@sensegrep/cli) |
| [@sensegrep/mcp](packages/mcp) | MCP server for AI agents | [![npm](https://img.shields.io/npm/v/@sensegrep/mcp)](https://www.npmjs.com/package/@sensegrep/mcp) |
| [sensegrep](packages/vscode) | VS Code extension | [Marketplace](https://marketplace.visualstudio.com/items?itemName=sensegrep.sensegrep) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and contribution guidelines.

## License

[Apache-2.0](LICENSE)
