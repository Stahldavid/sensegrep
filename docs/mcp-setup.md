# MCP Server Setup

sensegrep provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes semantic search as tools for AI coding assistants.

For practical, end-to-end workflows, see [Recipes](recipes/README.md).

## Installation

```bash
npm install -g @sensegrep/mcp
```

## Configuration

### Claude Code

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

| Variable | Default | Description |
|----------|---------|-------------|
| `SENSEGREP_ROOT` | cwd | Root directory to index and search |
| `SENSEGREP_WATCH` | `1` | Enable file watching (`0` to disable) |
| `SENSEGREP_PROVIDER` | `local` | Embedding provider (`local` or `gemini`) |
| `SENSEGREP_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | Embedding model name |
| `SENSEGREP_EMBED_DIM` | `384` | Embedding dimension |
| `SENSEGREP_EMBED_DEVICE` | `cpu` | Compute device (`cpu`, `cuda`, `webgpu`, `wasm`) |
| `GEMINI_API_KEY` | - | Required when using `gemini` provider |

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

Create or update the semantic index.

**Parameters:**
- `rootDir` (string): Directory to index
- `mode` (string): `incremental` (default) or `full`

### `sensegrep.stats`

Get index statistics.

**Parameters:**
- `rootDir` (string): Directory to check

### `sensegrep.detect_duplicates`

Find logical code duplicates.

**Parameters:**
- `rootDir` (string): Directory to analyze
- `threshold` (number): Similarity threshold 0.0-1.0 (default: 0.85)
- `scope` (string): `function`, `method`, or `all`
- `showCode` (boolean): Include code snippets

### `sensegrep.languages`

List supported languages or detect project languages.

**Parameters:**
- `detect` (boolean): Detect languages in project
- `variants` (boolean): Show all variants by language

## Behavior

- The MCP server automatically indexes the project on first tool call
- File watching is enabled by default - the server reindexes at most once per minute when changes are detected
- Embedding configuration is read from the index metadata, so searches always use the same model used for indexing
- The server loads `@sensegrep/core` lazily on first use

## Next Steps

- [Recipes](recipes/README.md) - Setup + workflow playbooks
- [Case Studies](case-studies.md) - Reproducible qualitative examples
