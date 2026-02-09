# sensegrep

**Semantic + structural code search with intelligent tree-shaking for AI agents.**

> Search by concept, not just keywords. Get precise results with 70-90% fewer tokens.

## Why sensegrep?

Traditional code search tools (grep, ripgrep, even Cursor) return either:
- **Too little**: Just matching lines without context
- **Too much**: Entire chunks with irrelevant code

Sensegrep combines **semantic search** + **structural filters** + **tree-shaking** to return exactly what you need:

```
BEFORE: grep "handleSubmit" → 45 results, read 5 files manually
AFTER:  sensegrep "form submission handler" → 3 exact functions
```

### Tree-shaking in action

When you search for "modal state management", sensegrep returns:

```typescript
// File: src/pages/BotSettingsPage.tsx (624 lines hidden in 3 regions)
// Matches: BotSettingsPage function

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";

export function BotSettingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BotConfig | null>(null);

  useEffect(() => {
    if (editingConfig) {
      setFormKey(editingConfig.key);
      // ... (relevant code shown)
    }
  }, [editingConfig, isModalOpen]);

  // ... (624 lines hidden) ...  ← Irrelevant JSX, handlers, etc.
}
```

**Result**: 96 lines of relevant code instead of 720 lines. **87% token reduction.**

## Features

| Feature | grep | Cursor | sensegrep |
|---------|------|--------|-----------|
| Semantic search (search by concept) | - | Yes | Yes |
| Structural filters (\`--type function\`) | - | - | Yes |
| Tree-shaking (hide irrelevant code) | - | - | Yes |
| Combine semantic + regex | - | - | Yes |
| Filter by complexity, async, exported | - | - | Yes |
| Pre-computed at index time | - | - | Yes |

## Quickstart

### Install
\`\`\`bash
npm i -g @sensegrep/cli
\`\`\`

### Index your repo
\`\`\`bash
sensegrep index
# or with watch mode (auto-reindex on changes)
sensegrep index --watch
\`\`\`

### Search
\`\`\`bash
# Semantic search
sensegrep search "authentication logic"

# With structural filters
sensegrep search "database query" --type function --exported

# Combine semantic + regex
sensegrep search "error handling" --pattern "catch|throw"

# Complex filters
sensegrep search "API endpoint" --type function --async --min-complexity 5
\`\`\`

## Examples

### Find form handlers
\`\`\`bash
sensegrep search "form submission handler" --type function --pattern "handleSubmit|onSubmit"
\`\`\`

### Find async API calls
\`\`\`bash
sensegrep search "HTTP request" --type function --async --pattern "fetch|axios"
\`\`\`

### Find complex functions that need refactoring
\`\`\`bash
sensegrep search "data processing" --min-complexity 10 --type function
\`\`\`

### Find exported React components
\`\`\`bash
sensegrep search "user interface component" --type function --exported --include "src/**/*.tsx"
\`\`\`

### Find methods in a specific class
\`\`\`bash
sensegrep search "validation logic" --type method --parent "UserService"
\`\`\`

### Detect duplicate code
\`\`\`bash
sensegrep detect-duplicates --threshold 0.85 --show-code
\`\`\`

## All Search Filters

| Filter | Description | Example |
|--------|-------------|---------|
| \`--type\` | Symbol type | \`function\`, \`class\`, \`method\`, \`type\`, \`variable\` |
| \`--pattern\` | Regex post-filter | \`--pattern "handle.*Click"\` |
| \`--exported\` | Only exported symbols | \`--exported true\` |
| \`--async\` | Only async functions | \`--async\` |
| \`--static\` | Only static methods | \`--static\` |
| \`--abstract\` | Only abstract classes/methods | \`--abstract\` |
| \`--min-complexity\` | Minimum cyclomatic complexity | \`--min-complexity 5\` |
| \`--max-complexity\` | Maximum cyclomatic complexity | \`--max-complexity 20\` |
| \`--parent\` | Parent class/scope | \`--parent "UserController"\` |
| \`--decorator\` | Filter by decorator | \`--decorator "@property"\` |
| \`--language\` | Filter by language | \`--language typescript\` |
| \`--include\` | File glob pattern | \`--include "src/**/*.ts"\` |
| \`--imports\` | Filter by imported module | \`--imports "react"\` |
| \`--has-docs\` | Require documentation | \`--has-docs true\` |
| \`--limit\` | Max results | \`--limit 10\` |
| \`--max-per-file\` | Max results per file | \`--max-per-file 2\` |
| \`--rerank\` | Enable cross-encoder reranking | \`--rerank\` |

## For AI Agents (MCP)

Sensegrep is designed for AI coding agents like Claude Code. Add to your MCP config:

\`\`\`json
{
  "mcpServers": {
    "sensegrep": {
      "command": "node",
      "args": ["/path/to/sensegrep/packages/mcp/dist/server.js"],
      "env": {
        "SENSEGREP_ROOT": "/path/to/your/project"
      }
    }
  }
}
\`\`\`

Available MCP tools:
- \`sensegrep_search\` - Semantic code search with all filters
- \`sensegrep_index\` - Index/reindex the codebase
- \`sensegrep_stats\` - Get index statistics
- \`sensegrep_detect_duplicates\` - Find duplicate code
- \`sensegrep_languages\` - List supported languages

### Why AI agents love sensegrep

1. **Fewer tool calls**: 1 precise search vs 5-10 iterative grep calls
2. **Fewer tokens**: Tree-shaking removes 70-90% of irrelevant code
3. **Structural filters**: Precise control over results (\`--type function --async --exported\`)
4. **Rich metadata**: symbolType, complexity, parentScope, decorators, etc.
5. **Less noise**: No more wading through imports, boilerplate, and irrelevant code

## Embeddings Configuration

### Local embeddings (default, free, offline)
\`\`\`json
{
  "provider": "local",
  "embedModel": "BAAI/bge-small-en-v1.5",
  "embedDim": 384,
  "device": "cpu"
}
\`\`\`

### Gemini embeddings (faster, requires API key)
\`\`\`bash
export GEMINI_API_KEY=your-key
\`\`\`
\`\`\`json
{
  "provider": "gemini",
  "embedModel": "gemini-embedding-001",
  "embedDim": 768
}
\`\`\`

Config location: \`~/.config/sensegrep/config.json\`

Or use environment variables:
- \`SENSEGREP_PROVIDER\` = \`local\` | \`gemini\`
- \`SENSEGREP_EMBED_MODEL\`
- \`SENSEGREP_EMBED_DIM\`
- \`SENSEGREP_RERANK_MODEL\`
- \`SENSEGREP_EMBED_DEVICE\` = \`cpu\` | \`cuda\` | \`webgpu\` | \`wasm\`

## How It Works

1. **Index**: Parse code with tree-sitter, extract semantic metadata, generate embeddings
2. **Search**: Semantic similarity + structural filters + optional regex post-filter
3. **Tree-shake**: Show relevant code, collapse irrelevant regions with line counts
4. **Return**: Precise results with minimal tokens

\`\`\`
Code → Tree-sitter → Chunks with metadata → Embeddings → LanceDB
                            ↓
Query → Embedding → Vector search → Structural filters → Tree-shaking → Results
\`\`\`

## Supported Languages

- TypeScript / JavaScript / TSX / JSX
- Python
- More coming soon (Go, Rust, Java, etc.)

## Project Structure

\`\`\`
packages/
├── core/     # Search engine, tree-shaker, embeddings
├── cli/      # Command-line interface
├── mcp/      # MCP server for AI agents
└── vscode/   # VSCode extension
\`\`\`

## Performance

| Codebase | Files | Index Time | Index Size |
|----------|-------|------------|------------|
| Small (100 files) | 100 | ~30s | ~5MB |
| Medium (500 files) | 500 | ~90s | ~25MB |
| Large (2000 files) | 2000 | ~5min | ~100MB |

Incremental reindexing: Only changed files are re-processed.

## License

Apache-2.0

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.
