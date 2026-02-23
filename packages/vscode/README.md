# Sensegrep for VS Code

**Semantic + structural code search with AI-powered duplicate detection.**

Search your codebase by meaning, not just text. Sensegrep uses AI embeddings and tree-sitter AST parsing to find conceptually relevant code.

## Features

- **Semantic Search** - Natural language queries to find relevant code (`Ctrl+Shift+S`)
- **Find Similar Code** - Select code and find similar patterns across your project (`Ctrl+Shift+F`)
- **Duplicate Detection** - AI-powered detection of logical duplicates with impact scoring
- **Structural Filters** - Filter by symbol type, exports, async, complexity, language, decorators, and more
- **Tree-Shaking** - Results collapse irrelevant code, showing only what matters
- **Code Lens** - Inline similarity and complexity info
- **Auto-Indexing** - Automatic incremental index updates on file changes
- **Semantic Folding** - Collapse unrelated code when navigating to results

## Supported Languages

- TypeScript / JavaScript (TSX/JSX)
- Python (dataclasses, protocols, decorators, async generators, TypedDict)

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Sensegrep: Semantic Search | `Ctrl+Shift+S` | Open semantic search |
| Sensegrep: Find Similar Code | `Ctrl+Shift+F` | Find code similar to selection |
| Sensegrep: Semantic Search (Advanced) | - | Search with all filter options |
| Sensegrep: Detect Duplicates | - | Analyze project for logical duplicates |
| Sensegrep: Index Project | - | Incremental index update |
| Sensegrep: Reindex Project (Full) | - | Full reindex from scratch |
| Sensegrep: Toggle Watch Mode | - | Enable/disable auto-reindexing |
| Sensegrep: Verify Index Integrity | - | Check index is up to date |
| Sensegrep: Show Index Stats | - | Display index metadata |
| Sensegrep: Fold Unrelated Code | - | Collapse code not related to current result |
| Sensegrep: Export Search Results | - | Export results to file |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sensegrep.autoIndex` | `true` | Index project on startup |
| `sensegrep.watchMode` | `true` | Auto-reindex on file changes |
| `sensegrep.watchIntervalMs` | `60000` | Min interval between reindexing (ms) |
| `sensegrep.showCodeLens` | `true` | Show inline similarity/complexity info |
| `sensegrep.showDiagnostics` | `true` | Show duplicate warnings in Problems panel |
| `sensegrep.semanticFolding` | `true` | Collapse unrelated code on navigation |
| `sensegrep.duplicateThreshold` | `0.85` | Similarity threshold for duplicates |
| `sensegrep.embeddings.provider` | `local` | `local` (transformers.js) or `gemini` (recommended) |
| `sensegrep.embeddings.model` | `BAAI/bge-small-en-v1.5` | Embedding model |
| `sensegrep.embeddings.device` | `cpu` | `cpu`, `cuda`, `webgpu`, `wasm` |

### Using Gemini Embeddings

For cloud-based embeddings (recommended):

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Run **Sensegrep: Set Gemini API Key** or set the `GEMINI_API_KEY` env variable
3. Set `sensegrep.embeddings.provider` to `"gemini"`

Why recommended: Gemini generally gives better semantic search quality and handles much larger token contexts than local embedding models.

Local embeddings remain supported, and support for additional providers/APIs is coming soon.

## Requirements

- VS Code 1.85+
- Node.js 18+ (for the embedded search engine)

## Links

- [GitHub](https://github.com/Stahldavid/sensegrep)
- [CLI & MCP packages](https://www.npmjs.com/org/sensegrep)
- [Documentation](https://github.com/Stahldavid/sensegrep/tree/main/docs)

## License

[Apache-2.0](https://github.com/Stahldavid/sensegrep/blob/main/LICENSE)
