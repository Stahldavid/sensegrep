# Architecture

sensegrep is a semantic code search engine that combines AI embeddings with tree-sitter AST parsing. This document explains the internal pipeline.

## Pipeline Overview

```
Source files
    │
    ▼
┌─────────────────┐
│  Tree-Sitter    │  Parse source code into ASTs
│  AST Parsing    │  Extract symbols + metadata
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chunker        │  Split code into semantic chunks
│                 │  Aligned to symbol boundaries
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Embeddings     │  Generate vector embeddings
│  (HF / Gemini)  │  for each chunk
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LanceDB        │  Store embeddings + metadata
│  Vector Store   │  for fast similarity search
└────────┬────────┘
         │
    Query│
         ▼
┌─────────────────┐
│  Search +       │  Vector similarity + structural filters
│  Reranking      │  Optional cross-encoder reranking
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tree-Shaker    │  Collapse irrelevant code
│                 │  Show only relevant symbols
└─────────────────┘
```

## Components

### Tree-Sitter AST Parsing

sensegrep uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/) via WASM to parse source code into ASTs. Each language has a dedicated parser that extracts:

- **Symbol type**: function, class, method, type, variable, enum, module
- **Language-specific variant**: interface, dataclass, protocol, async generator, etc.
- **Export status**: whether the symbol is exported
- **Async status**: whether the function/method is async
- **Cyclomatic complexity**: computed from control flow
- **Documentation**: JSDoc, docstrings, comments
- **Decorators**: @property, @dataclass, @route, etc.
- **Parent scope**: enclosing class or module
- **Imports**: modules imported by the file

Language parsers live in `packages/core/src/semantic/language/`.

### Chunker

The chunker (`packages/core/src/semantic/chunker.ts`) splits source code into chunks that align with symbol boundaries. Each chunk contains:

- The full source code of a symbol (function, class, etc.)
- All extracted metadata
- File path and line range

This ensures that search results return complete, meaningful code units rather than arbitrary line ranges.

### Embeddings

sensegrep supports two embedding providers:

**Local (default)**: Uses [transformers.js](https://huggingface.co/docs/transformers.js) with ONNX Runtime to run models locally. Default model: `BAAI/bge-small-en-v1.5` (384 dimensions). Supports CPU, CUDA, WebGPU, and WASM backends.

**Gemini**: Uses Google's Gemini Embedding API for cloud-based embeddings. Requires a `GEMINI_API_KEY`.

Configuration is managed through `packages/core/src/semantic/embeddings-hf.ts` and stored per-index so searches always use the same model that was used for indexing.

### LanceDB Vector Store

[LanceDB](https://lancedb.github.io/lancedb/) stores embeddings and metadata in a local columnar format. It provides:

- Fast approximate nearest neighbor (ANN) search
- Metadata filtering (pre-filter before vector search)
- Incremental updates (add/remove individual records)

The store implementation is in `packages/core/src/semantic/lancedb.ts`.

### Indexer

The indexer (`packages/core/src/semantic/indexer.ts`) orchestrates the full indexing pipeline:

1. Scan project files (respecting .gitignore)
2. Hash each file for change detection
3. Parse files with tree-sitter
4. Chunk symbols with metadata
5. Generate embeddings
6. Store in LanceDB

It supports both full and incremental indexing. Incremental mode only processes files whose hashes have changed, making re-indexing fast after small changes.

### Tree-Shaker

The tree-shaker (`packages/core/src/semantic/tree-shaker.ts`) post-processes search results to improve readability:

- Given a file and a set of relevant line ranges, it collapses irrelevant symbols
- Imports and class structure are always preserved
- Collapsed sections show `// ... N lines hidden ...` markers
- This dramatically reduces noise when results come from large files

### Index Watcher

The watcher uses `@parcel/watcher` to monitor filesystem changes and trigger incremental reindexing at a configurable interval (default: 60 seconds). This keeps the index fresh without manual re-runs.

## Packages

| Package | Role |
|---------|------|
| `@sensegrep/core` | All indexing, search, and analysis logic |
| `@sensegrep/cli` | Thin CLI wrapper that calls core |
| `@sensegrep/mcp` | MCP server exposing core as tools |
| `sensegrep` (vscode) | VS Code extension with UI |

All packages depend on `@sensegrep/core`. The CLI, MCP, and VS Code extension are thin layers that map their respective interfaces to core functionality.
