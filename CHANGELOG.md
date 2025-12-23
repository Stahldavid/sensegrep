# Changelog

## 0.1.3 - 2025-12-23
### Changed
- Core is now Node-compatible (removed Bun runtime dependency).
- Tree-sitter WASM loading fixed for Node (no fallback to regex).
- CLI/MCP versions aligned to core and depend on `@sensegrep/core@^0.1.3`.
- README quickstart updated to use the published CLI.

## 0.1.0 - 2025-12-23
### Added
- Initial release of SenseGrep core, CLI, and MCP server.
- Hybrid semantic + structural search with optional regex filtering.
- Incremental indexing with hash-based verification.
- Optional cross-encoder reranking.
