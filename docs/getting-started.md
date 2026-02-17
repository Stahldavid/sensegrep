# Getting Started

This guide walks you through installing sensegrep, indexing your first project, and running your first semantic search.

## Requirements

- **Node.js** >= 18
- ~500 MB disk space for the embedding model (downloaded on first run)

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

## Index Your Project

Before you can search, sensegrep needs to build a semantic index of your codebase:

```bash
cd /path/to/your/project
sensegrep index --root .
```

On first run, sensegrep will download the embedding model (~90 MB). Indexing a medium-sized project (~500 files) typically takes 20-60 seconds.

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

See [MCP Setup](mcp-setup.md) for detailed configuration per tool.

## Next Steps

- [Architecture](architecture.md) - Understand how sensegrep works internally
- [CLI Reference](cli-reference.md) - Full list of commands and flags
- [MCP Setup](mcp-setup.md) - Configure sensegrep with Claude Code, Cursor, and more
