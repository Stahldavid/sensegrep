# sensegrep

Semantic + structural code search (core + CLI + MCP).

## Quickstart
Install the CLI:
```
npm i -g @sensegrep/cli
```

Index a repo:
```
sensegrep index --root /path/to/repo
```

Search:
```
sensegrep search "authentication logic" --type function --exported
```

Verify index (hash-only):
```
sensegrep verify --root /path/to/repo
```

Index only if needed:
```
sensegrep index --root /path/to/repo --verify
```

## MCP
Run the MCP server (stdio JSON-RPC):
```
node packages/mcp/dist/server.js
```

Available tools:
- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.stats`

## Structure
- `packages/core`: search engine
- `packages/cli`: CLI wrapper
- `packages/mcp`: MCP server
