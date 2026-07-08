# Sensegrep for VS Code

**Semantic + structural code search with AI-powered duplicate detection.**

Search your codebase by meaning, not just text. Sensegrep uses AI embeddings and tree-sitter AST parsing to find conceptually relevant code.

## Features

- **Semantic Search** - Natural language queries to find relevant code
- **Survey & Cluster** - Map a code domain or split a broad theme into related subtopics
- **Find Similar Code** - Select code and find similar patterns across your project
- **Duplicate Detection** - AI-powered detection of logical duplicates with impact scoring
- **Structural Filters** - Filter by symbol type, exports, async, complexity, language, decorators, and more
- **Tree-Shaking** - Results collapse irrelevant code, showing only what matters
- **Code Lens** - Inline Find Similar actions
- **Auto-Indexing** - Automatic incremental index updates on file changes
- **Semantic Folding** - Collapse unrelated code when navigating to results
- **Config-first Embeddings** - Share `~/.config/sensegrep/config.json` with CLI and MCP

## Supported Languages

- TypeScript / JavaScript (TSX/JSX)
- Python (dataclasses, protocols, decorators, async generators, TypedDict)
- Java (classes, interfaces, records, annotations, methods)
- Vue (single-file components with script and script setup support)

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Sensegrep: Semantic Search | - | Open semantic search |
| Sensegrep: Find Similar Code | - | Find code similar to selection |
| Sensegrep: Semantic Search (Advanced) | - | Search with all filter options |
| Sensegrep: Survey Code Domain | - | Group semantically related hits into reading domains |
| Sensegrep: Cluster Code Theme | - | Decompose a broad query into coherent subthemes |
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
| `sensegrep.autoIndex` | `false` | Index project when Sensegrep activates |
| `sensegrep.watchMode` | `true` | Auto-reindex on file changes |
| `sensegrep.watchIntervalMs` | `60000` | Min interval between reindexing (ms) |
| `sensegrep.includeDocs` | `false` | Include Markdown/documentation files in the index |
| `sensegrep.includeConfig` | `false` | Include JSON/YAML/TOML config files in the index |
| `sensegrep.showCodeLens` | `true` | Show inline Find Similar actions |
| `sensegrep.showDiagnostics` | `true` | Show duplicate warnings in Problems panel |
| `sensegrep.semanticFolding` | `true` | Collapse unrelated code on navigation |
| `sensegrep.duplicateThreshold` | `0.85` | Similarity threshold for duplicates |
| `sensegrep.embeddings.provider` | `config` | `config`, `ollama`, `gemini`, `openai`, or `bedrock` |
| `sensegrep.embeddings.model` | empty | Embedding model override |

### Embeddings Configuration

By default, the extension uses the same configuration as the CLI/MCP:

```json
{
  "provider": "bedrock",
  "embedModel": "cohere.embed-v4:0",
  "embedDim": 1536,
  "region": "us-east-1"
}
```

Store it at `~/.config/sensegrep/config.json`, or configure equivalent environment variables.

For LM Studio or another OpenAI-compatible embeddings server, set `provider` to `openai`, `baseUrl` to the server `/v1` endpoint, and `embedModel`/`embedDim` to the running embedding model.

For local Ollama, set `provider` to `ollama` or leave the provider unset; the default model is `qwen3-embedding:0.6b` with `embedDim` `1024`.

For Gemini, set `sensegrep.embeddings.provider` to `"gemini"` and run **Sensegrep: Set Gemini API Key** or set `GEMINI_API_KEY`.

For Amazon Bedrock, set `provider` to `bedrock` in `config.json` or set `sensegrep.embeddings.provider` to `"bedrock"` and configure credentials/region through the standard Bedrock setup.

## Development

```bash
npm run check --workspace sensegrep
npm run build --workspace sensegrep
npm test --workspace sensegrep
```

Package a platform-specific VSIX with one of:

```bash
npm run package:win32-x64 --workspace sensegrep
npm run package:linux-x64 --workspace sensegrep
npm run package:darwin-arm64 --workspace sensegrep
```

## Requirements

- VS Code 1.85+
- Node.js 18+ (for the embedded search engine)

## Links

- [GitHub](https://github.com/Stahldavid/sensegrep)
- [CLI & MCP packages](https://www.npmjs.com/org/sensegrep)
- [Documentation](https://github.com/Stahldavid/sensegrep/tree/main/docs)

## License

[Apache-2.0](https://github.com/Stahldavid/sensegrep/blob/main/LICENSE)
