# Getting Started

This guide walks you through installing sensegrep, indexing your first project, and running your first semantic search.

## Requirements

- **Node.js** >= 18
- Ollama for default local embeddings, or an embedding provider credential for Gemini, OpenAI-compatible APIs, or Amazon Bedrock
- Local disk space for the LanceDB index (size depends on repository/chunk count)

## Installation

### CLI

```bash
npm install -g @sensegrep/cli
```

### MCP Server (for AI coding assistants)

```bash
npm install -g @sensegrep/mcp
```

### VS Code Extension

Search for **"Sensegrep"** in the VS Code Extensions panel.

## Smoke Test Your Setup

Before indexing, verify that the CLI/core can load, that language detection works, and that embedding configuration is visible:

```bash
sensegrep selftest --root .
```

`selftest` does **not** call embeddings unless you pass `--deep`; it reports provider/model/dimension and tells you which credential variables or local services are needed.

## Configure Embeddings

sensegrep defaults to local Ollama when no API key/provider is configured. You can also explicitly set Gemini, OpenAI-compatible APIs, or Amazon Bedrock before building a real index:

```bash
# Default local Ollama (no API key)
ollama pull nomic-embed-text:v1.5
# Optional if you use a non-default Ollama model/URL:
export SENSEGREP_PROVIDER=ollama
export SENSEGREP_EMBED_MODEL="nomic-embed-text:v1.5"
export SENSEGREP_EMBED_DIM=768
export SENSEGREP_OLLAMA_BASE_URL="http://127.0.0.1:11434"

# Gemini
export SENSEGREP_PROVIDER=gemini
export GEMINI_API_KEY="your_ai_studio_key"

# OpenAI-compatible / Fireworks / local OpenAI-compatible server
export SENSEGREP_PROVIDER=openai
export SENSEGREP_OPENAI_API_KEY="your_key_or_dummy_value_for_local_servers"
export SENSEGREP_OPENAI_BASE_URL="https://api.fireworks.ai/inference/v1"
export SENSEGREP_EMBED_MODEL="fireworks/qwen3-embedding-8b"
export SENSEGREP_EMBED_DIM=768

# Experimental fastembed-rs sidecar (Jina code embeddings only)
export SENSEGREP_PROVIDER=fastembed
export SENSEGREP_FASTEMBED_BASE_URL="http://127.0.0.1:11435/v1"
export SENSEGREP_EMBED_MODEL="jinaai/jina-embeddings-v2-base-code"
export SENSEGREP_EMBED_DIM=768

# Amazon Bedrock
export SENSEGREP_PROVIDER=bedrock
export AWS_REGION="us-east-1"
export SENSEGREP_EMBED_MODEL="cohere.embed-v4:0"
export SENSEGREP_EMBED_DIM=1536
```

For local OpenAI-compatible embedding servers, set `SENSEGREP_PROVIDER=openai`, point `SENSEGREP_OPENAI_BASE_URL` at the local `/v1` endpoint, and set `SENSEGREP_EMBED_DIM` to the exact dimension returned by that server. For native Ollama, use `SENSEGREP_PROVIDER=ollama` and point `SENSEGREP_OLLAMA_BASE_URL` at the Ollama base URL if it is not the default. For the experimental fastembed-rs sidecar, use `SENSEGREP_PROVIDER=fastembed`; initial support is limited to `jinaai/jina-embeddings-v2-base-code`. See [fastembed-rs sidecar](fastembed-rs-sidecar.md).

## Index Your Project

Before you can search, sensegrep needs to build a semantic index of your codebase:

```bash
cd /path/to/your/project
sensegrep index --root .
```

On first run, sensegrep creates a local LanceDB index and calls your configured embedding provider. Indexing time depends on repository size, provider latency/rate limits, local model speed, and chunk count.

### Incremental indexing

After the initial index, subsequent runs only process changed files:

```bash
sensegrep index --root .
```

### Watch mode

Keep the index up to date automatically:

```bash
sensegrep index --root . --watch
```

This reindexes at most once per minute when files change.

### Verify index integrity

```bash
sensegrep verify --root .
```

### Index compatibility

Each index records the embedding provider, model, dimension, and distance metric used to create it. If you change provider, model, base URL, dimension, or local server pooling behavior, rebuild the index:

```bash
sensegrep index --root . --full --no-watch
```

Same dimension does **not** mean compatible embeddings; two 768-dimensional models still produce different vector spaces.

## Your First Search

```bash
# Semantic search - find code by meaning
sensegrep search "error handling and retry logic"

# Add structural filters
sensegrep search "authentication" --type function --exported

# Filter by language
sensegrep search "data validation" --language python
```

## Useful Filter Combinations

```bash
# Find complex undocumented code (refactoring candidates)
sensegrep search "business logic" --min-complexity 10 --has-docs false

# Find exported async functions
sensegrep search "data fetching" --type function --exported --async

# Find Python dataclasses
sensegrep search "user model" --type class --variant dataclass --language python

# Search with regex post-filter
sensegrep search "database operations" --pattern "pool|connection"
```

## Duplicate Detection

```bash
# Find logical duplicates
sensegrep detect-duplicates

# Show the actual duplicate code
sensegrep detect-duplicates --show-code

# Only cross-file duplicates (most actionable)
sensegrep detect-duplicates --cross-file-only --only-exported
```

## Using with MCP (AI Assistants)

After installing `@sensegrep/mcp`, add it to your AI assistant's configuration:

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

The MCP server automatically watches for changes and keeps the index up to date.

See [MCP Setup](mcp-setup.md) for base configuration and [Recipes](recipes/README.md) for practical workflows.

## Next Steps

- [Architecture](architecture.md) - Understand how sensegrep works internally
- [CLI Reference](cli-reference.md) - Full list of commands and flags
- [MCP Setup](mcp-setup.md) - Configure sensegrep with Claude Code, Cursor, and more
- [Recipes](recipes/README.md) - Copy-paste setup and workflow playbooks
- [Case Studies](case-studies.md) - Reproducible examples from public repositories
- [Roadmap](../ROADMAP.md) - Current priorities and upcoming milestones
