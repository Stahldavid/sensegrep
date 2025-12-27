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

Index and watch (reindex at most once per minute if there are changes):
```
sensegrep index --root /path/to/repo --watch
```

Search:
```
sensegrep search "authentication logic" --type function --exported
```

## Embeddings config
You can set global defaults via config/env. The CLI supports per-command overrides; MCP tools use config only.

CLI overrides:
```
sensegrep search "auth flow" --embed-model BAAI/bge-base-en-v1.5 --embed-dim 768
sensegrep search "payments" --provider gemini --embed-model gemini-embedding-001 --embed-dim 768
sensegrep search "perf" --device cuda
```

Config file (global defaults):
```
~/.config/sensegrep/config.json
```
Example:
```
{
  "provider": "local",
  "embedModel": "BAAI/bge-small-en-v1.5",
  "embedDim": 384,
  "rerankModel": "Xenova/ms-marco-MiniLM-L-6-v2",
  "device": "cpu"
}
```

Env vars (override config):
- `SENSEGREP_PROVIDER` = `local` | `gemini`
- `SENSEGREP_EMBED_MODEL`
- `SENSEGREP_EMBED_DIM`
- `SENSEGREP_RERANK_MODEL`
- `SENSEGREP_EMBED_DEVICE` = `cpu` | `cuda` | `webgpu` | `wasm`

MCP (no per-call overrides; uses config and index metadata):
```
{
  "name": "sensegrep.index",
  "arguments": {
    "rootDir": "/path/to/repo",
    "mode": "full"
  }
}
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

The MCP server watches the root directory (SENSEGREP_ROOT or cwd) and reindexes
at most once per minute when changes are detected. Set SENSEGREP_WATCH=0 to
disable.

Available tools:
- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.stats`

## Structure
- `packages/core`: search engine
- `packages/cli`: CLI wrapper
- `packages/mcp`: MCP server


