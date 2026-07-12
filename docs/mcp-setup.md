# MCP Server Setup

sensegrep provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes semantic search as tools for AI coding assistants.

For practical, end-to-end workflows, see [Recipes](recipes/README.md).

## Claude Code Plugin (recommended)

The easiest way to set up sensegrep in Claude Code — zero configuration:

```bash
claude plugin marketplace add Stahldavid/sensegrep
claude plugin install sensegrep
```

The plugin automatically configures the MCP server and includes a skill that teaches Claude when and how to use sensegrep. No manual JSON editing required.

If you prefer explicit marketplace syntax after the marketplace has already been added:

```bash
claude plugin install sensegrep@sensegrep
```

On a fresh setup, this explicit form fails until you first run:

```bash
claude plugin marketplace add Stahldavid/sensegrep
```

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

### Codex (OpenAI)

Codex reads MCP config from `~/.codex/config.toml` (TOML, not JSON) and uses
`mcp_servers` (underscore). Add it with the CLI:

```bash
codex mcp add sensegrep --env SENSEGREP_ROOT=/path/to/your/project -- sensegrep-mcp
```

Or edit `~/.codex/config.toml` manually:

```toml
[mcp_servers.sensegrep]
command = "sensegrep-mcp"
args = []
env = { SENSEGREP_ROOT = "/path/to/your/project" }
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
| `SENSEGREP_PROVIDER` | `ollama` when no API key/provider is configured | Embedding provider (`ollama`, `gemini`, `openai`, `bedrock`) |
| `SENSEGREP_EMBED_MODEL` | Provider-dependent | Embedding model name override |
| `SENSEGREP_EMBED_DIM` | Provider-dependent | Embedding dimension override |
| `SENSEGREP_OPENAI_BATCH_SIZE` | `96` for OpenRouter Qwen3 embeddings, otherwise `64` | OpenAI-compatible embeddings request batch size |
| `SENSEGREP_OPENAI_CONCURRENCY` | `1` | Concurrent OpenAI-compatible requests; benchmark before increasing |
| `SENSEGREP_QUERY_CACHE` | `true` | Cache deterministic query vectors by opaque hash; set `false` to disable |
| `SENSEGREP_QUERY_CACHE_TTL_MS` | 30 days | Query-vector cache lifetime |
| `SENSEGREP_QUERY_CACHE_MAX_ENTRIES` | `2000` | Maximum persistent query-vector entries |
| `SENSEGREP_ADAPTIVE_HYBRID_DELAY_MS` | `75` | Delay lexical work briefly so strong cached semantic evidence can skip it |
| `SENSEGREP_ADAPTIVE_HYBRID_MIN_SCORE` | `0.72` | Minimum top semantic score for adaptive lexical cancellation |
| `SENSEGREP_BEDROCK_REGION` | - | Amazon Bedrock region override |

### API Keys and Endpoints

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | - | Gemini API key |
| `GOOGLE_API_KEY` | - | Gemini API key fallback |
| `SENSEGREP_OPENAI_API_KEY` | - | OpenAI-compatible API key |
| `FIREWORKS_API_KEY` | - | OpenAI-compatible key fallback |
| `OPENAI_API_KEY` | - | OpenAI-compatible key fallback |
| `SENSEGREP_BEDROCK_API_KEY` | - | Amazon Bedrock bearer API key; omit to use the AWS SDK credential chain |
| `SENSEGREP_OPENAI_BASE_URL` | `https://api.fireworks.ai/inference/v1` | OpenAI-compatible base URL |
| `SENSEGREP_OPENROUTER_REFERER` | `https://github.com/Stahldavid/sensegrep` | Optional OpenRouter attribution header |
| `SENSEGREP_OPENROUTER_TITLE` | `sensegrep` | Optional OpenRouter attribution header |
| `SENSEGREP_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Native Ollama base URL |
| `AWS_REGION` | - | AWS SDK region for Amazon Bedrock |
| `AWS_DEFAULT_REGION` | - | AWS SDK fallback region for Amazon Bedrock |

For default local Ollama, run `ollama pull qwen3-embedding:0.6b` and leave provider/API keys unset, or set `SENSEGREP_PROVIDER=ollama` explicitly. For local OpenAI-compatible embedding servers, set `SENSEGREP_PROVIDER=openai`, point `SENSEGREP_OPENAI_BASE_URL` at the local `/v1` base URL, and set `SENSEGREP_EMBED_DIM` to the exact vector dimension returned by the server. OpenRouter Qwen3 embedding models default to a `96` item request batch and use the Qwen3 32K token limit. The API key can be a dummy value only if your local server accepts it.

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
- `pattern` (string): non-exhaustive regex post-filter on semantic candidates
- `sensegrep_literal`: exhaustive literal/regex search without embedding calls
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
- Embedding configuration is read from the index metadata, so searches always use the same provider/model/dimension used for indexing
- If you change provider, model, base URL, dimension, local server pooling behavior, or task-prefix strategy, rebuild the index with `sensegrep index --root <project> --full --no-watch`
- Same dimension does **not** imply compatibility; two 768-dimensional embedding models produce different vector spaces
- The server loads `@sensegrep/core` lazily on first use

## Next Steps

- [Recipes](recipes/README.md) - Setup + workflow playbooks
- [Case Studies](case-studies.md) - Reproducible qualitative examples
