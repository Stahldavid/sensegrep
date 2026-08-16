# @sensegrep/mcp

MCP server exposing sensegrep capabilities to AI coding assistants.

## Install

```bash
npm install -g @sensegrep/mcp
```

## MCP Configuration

```json
{
  "mcpServers": {
    "sensegrep": {
      "command": "npx",
      "args": ["-y", "@sensegrep/mcp"]
    }
  }
}
```

Or with global install first:

```bash
npm install -g @sensegrep/mcp
```

```json
{
  "mcpServers": {
    "sensegrep": {
      "command": "sensegrep-mcp"
    }
  }
}
```

## Experimental local HTTP

For local MCP 2026-07-28 experiments, run `sensegrep-mcp-http` with
`SENSEGREP_ROOT` pointing at an already indexed checkout. It binds to
`127.0.0.1:7337/mcp`, creates a fresh server per request, disables the watcher,
and exposes query tools without `sensegrep_index` or caller-controlled
`rootDir`. This entrypoint is not production-ready: remote deployment still
requires authentication, authorized workspace IDs, persistent index storage,
and a separate indexing worker. The existing `sensegrep-mcp` stdio entrypoint
remains the supported local/indexing path.

## Tools

Canonical tool names:

- `sensegrep_search`
- `sensegrep_show`
- `sensegrep_literal`
- `sensegrep_context`
- `sensegrep_survey`
- `sensegrep_cluster`
- `sensegrep_graph`
- `sensegrep_index`
- `sensegrep_detect_duplicates`

Search returns schema v2 compact cards by default. Call `sensegrep_show` with a selected
card `id`, or set `resultDetail` to `content`/`full`, to expand only the evidence an agent
needs. MCP publishes an output schema and returns the complete payload once in
`structuredContent`; textual content is only a short transport summary. Results report
retrieval sufficiency, compact index state, applicable budgets, and structured warnings.

Legacy aliases are still accepted for compatibility:

- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.detect_duplicates`

## Environment Variables

Common MCP/runtime variables:

- `SENSEGREP_ROOT` - root directory to index/search
- `SENSEGREP_WATCH` - watcher toggle (`0`, `false`, `off`, `no` disables)
- `SENSEGREP_PROVIDER` - `ollama`, `gemini`, `openai`, or `bedrock`
- `SENSEGREP_EMBED_MODEL`, `SENSEGREP_EMBED_DIM`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` / `OPENAI_API_KEY`

For the complete and official list, see `docs/mcp-setup.md` in the repository.

## Documentation

- MCP setup: https://github.com/Stahldavid/sensegrep/blob/main/docs/mcp-setup.md
- Repository: https://github.com/Stahldavid/sensegrep
