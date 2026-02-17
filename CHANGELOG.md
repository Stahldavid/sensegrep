# Changelog

All notable changes to this project will be documented in this file.

## 0.1.16/0.1.17 - 2026-02

### Added
- Multilingual support: Python language with dataclasses, protocols, decorators, async generators, TypedDict
- Dynamic language detection (`sensegrep languages --detect`)
- Language-specific variants and decorator filters
- VS Code extension: multilingual search filters, dynamic language autocomplete
- Duplicate detection: AST token-based similarity with impact scoring
- Semantic tree-shaking for search results (collapse irrelevant code)
- Collapsible region caching during indexing for faster tree-shaking
- `sensegrep.detect_duplicates` and `sensegrep.languages` MCP tools

### Changed
- MCP server migrated to official `@modelcontextprotocol/sdk`
- Improved query parameter descriptions in MCP tools
- Optimized chunking for Gemini embeddings
- Enhanced search filters and build robustness

### Fixed
- Cache directory creation before version write
- Multilingual metadata included in indexed documents
- VS Code extension: search UX, settings, diagnostics, indexing progress
- ONNX Runtime 1.23.2 compatibility

## 0.1.3 - 2025-12-23

### Changed
- Core is now Node-compatible (removed Bun runtime dependency)
- Tree-sitter WASM loading fixed for Node (no fallback to regex)
- CLI/MCP versions aligned to core and depend on `@sensegrep/core@^0.1.3`
- README quickstart updated to use the published CLI

## 0.1.0 - 2025-12-23

### Added
- Initial release of sensegrep core, CLI, and MCP server
- Hybrid semantic + structural search with optional regex filtering
- Incremental indexing with hash-based verification
- Optional cross-encoder reranking
- Embedding configuration support (local HuggingFace + Gemini)
- CLI overrides for embedding model, dimension, and device
