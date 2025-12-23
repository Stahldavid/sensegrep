# sensegrep

Semantic + structural code search (core + CLI + MCP).

## Quickstart
Index a repo:
```
bun packages/cli/src/main.ts index --root /path/to/repo
```

Search:
```
bun packages/cli/src/main.ts search "authentication logic" --type function --exported
```

Verify index (hash-only):
```
bun packages/cli/src/main.ts verify --root /path/to/repo
```

Index only if needed:
```
bun packages/cli/src/main.ts index --root /path/to/repo --verify
```

## MCP
Run the MCP server (stdio JSON-RPC):
```
bun packages/mcp/src/server.ts
```

Available tools:
- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.stats`

## Structure
- `packages/core`: search engine
- `packages/cli`: CLI wrapper
- `packages/mcp`: MCP server
