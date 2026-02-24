# MCP Server Setup

sensegrep provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes semantic search as tools for AI coding assistants.

For practical, end-to-end workflows, see [Recipes](recipes/README.md).

## Claude Code Plugin (recommended)

The easiest way to set up sensegrep in Claude Code — zero configuration:

```bash
claude plugin install sensegrep
```

The plugin automatically configures the MCP server and includes a skill that teaches Claude when and how to use sensegrep. No manual JSON editing required.

## Cursor Plugin

The easiest way to set up sensegrep in Cursor:

```bash
cursor plugin install sensegrep
```

The plugin includes the MCP server, an always-on rule to prefer sensegrep, and a skill with full filter reference.

For manual setup or other editors, continue below.

## Manual Installation

```bash
npm install -g @sensegrep/mcp
```

## Configuration

### Claude Code (manual)

Add to `~/.claude.json` or your project's `.claude.json`:

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

### Cursor

Add to your Cursor MCP settings:

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

### Windsurf

Add to your Windsurf MCP configuration:

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

### Generic MCP Client

The server communicates via stdio JSON-RPC:

```bash
sensegrep-mcp
```

Or run directly:

```bash
node node_modules/@sensegrep/mcp/dist/server.js
```

## Environment Variables

Variables below are supported by the current runtime.

### MCP Runtime

| Variable | Default | Description |
|----------|---------|-------------|
| `SENSEGREP_ROOT` | `cwd` | Root directory to index and search |
| `SENSEGREP_WATCH` | `1` | Enable file watching (`0`, `false`, `off`, `no` to disable) |

### Embeddings (Primary)

| Variable | Default | Description |
|----------|---------|-------------|
| `SENSEGREP_PROVIDER` | `local` | Embedding provider (`local`, `gemini`, `openai`) |
| `SENSEGREP_EMBED_MODEL` | Provider-dependent | Embedding model name override |
| `SENSEGREP_EMBED_DIM` | Provider-dependent | Embedding dimension override |
| `SENSEGREP_EMBED_DEVICE` | auto/`cpu` | Device (`cpu`, `cuda`, `webgpu`, `wasm`) |
| `SENSEGREP_RERANK_MODEL` | `Xenova/ms-marco-MiniLM-L-6-v2` | Reranker model |

### API Keys and Endpoints

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | - | Gemini API key |
| `GOOGLE_API_KEY` | - | Gemini API key fallback |
| `SENSEGREP_OPENAI_API_KEY` | - | OpenAI-compatible API key |
| `FIREWORKS_API_KEY` | - | OpenAI-compatible key fallback |
| `OPENAI_API_KEY` | - | OpenAI-compatible key fallback |
| `SENSEGREP_OPENAI_BASE_URL` | `https://api.fireworks.ai/inference/v1` | OpenAI-compatible base URL |

### Language Selection

| Variable | Default | Description |
|----------|---------|-------------|
| `SENSEGREP_LANGUAGES` | auto-detect | Comma-separated language override (for CLI/core config resolution) |

### Compatibility Aliases

| Variable | Description |
|----------|-------------|
| `OPENCODE_SEMANTIC_EMBEDDINGS` | Alias for provider selection |
| `OPENCODE_GEMINI_EMBED_MODEL` | Gemini model fallback |
| `OPENCODE_GEMINI_EMBED_DIM` | Gemini dimension fallback |
| `OPENCODE_EMBEDDINGS_DEVICE` | Device fallback |

### Precedence (high -> low)

1. Runtime/CLI overrides
2. Environment variables
3. Global config file (`~/.config/sensegrep/config.json`)
4. Built-in defaults

## Available Tools

### `sensegrep.search`

Semantic + structural code search.

**Parameters:**
- `query` (string, required): Natural language search query
- `symbolType` (string): `function`, `class`, `method`, `type`, `variable`, `enum`, `module`
- `isExported` (boolean): Only exported symbols
- `isAsync` (boolean): Only async functions/methods
- `language` (string): Filter by language
- `pattern` (string): Regex post-filter
- `limit` (number): Max results (default: 20)
- `include` (string): File glob filter
- `variant` (string): Language-specific variant
- `decorator` (string): Filter by decorator
- `minComplexity` / `maxComplexity` (number): Complexity range
- `hasDocumentation` (boolean): Require docs
- `parentScope` (string): Parent class/module name
- `rerank` (boolean): Enable cross-encoder reranking
- `rootDir` (string): Override root directory

### `sensegrep.index`

Create/update the semantic index or fetch index stats.

**Parameters:**
- `action` (string): `index` (default) or `stats`
- `rootDir` (string): Directory to index
- `mode` (string): `incremental` (default) or `full` when `action=index`

### `sensegrep.detect_duplicates`

Find logical code duplicates.

**Parameters:**
- `rootDir` (string): Directory to analyze
- `threshold` (number): Similarity threshold 0.0-1.0 (default: 0.85)
- `scope` (string): `function`, `method`, or `all`
- `showCode` (boolean): Include code snippets

## Behavior

- The MCP server automatically indexes the project on first tool call
- File watching is enabled by default - the server reindexes at most once per minute when changes are detected
- Embedding configuration is read from the index metadata, so searches always use the same model used for indexing
- The server loads `@sensegrep/core` lazily on first use

## Next Steps

- [Recipes](recipes/README.md) - Setup + workflow playbooks
- [Case Studies](case-studies.md) - Reproducible qualitative examples
