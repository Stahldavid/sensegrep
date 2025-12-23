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

## Embeddings config
You can override the embedding model/dimension per command, or set global defaults.

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

MCP overrides (per call):
```
{
  "name": "sensegrep.search",
  "arguments": {
    "query": "auth flow",
    "embedModel": "BAAI/bge-base-en-v1.5",
    "embedDim": 768
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

Available tools:
- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.stats`

## Structure
- `packages/core`: search engine
- `packages/cli`: CLI wrapper
- `packages/mcp`: MCP server
