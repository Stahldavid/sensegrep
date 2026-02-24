# @sensegrep/mcp

MCP server exposing sensegrep capabilities to AI coding assistants.

## Install

```bash
npm install -g @sensegrep/mcp
```

## MCP Configuration

```json
{
  "servers": {
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
  "servers": {
    "sensegrep": {
      "command": "sensegrep-mcp"
    }
  }
}
```

## Tools

- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.detect_duplicates`

## Environment Variables

Common MCP/runtime variables:

- `SENSEGREP_ROOT` - root directory to index/search
- `SENSEGREP_WATCH` - watcher toggle (`0`, `false`, `off`, `no` disables)
- `SENSEGREP_PROVIDER` - `local`, `gemini`, or `openai`
- `SENSEGREP_EMBED_MODEL`, `SENSEGREP_EMBED_DIM`, `SENSEGREP_EMBED_DEVICE`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` / `OPENAI_API_KEY`

For the complete and official list, see `docs/mcp-setup.md` in the repository.

## Documentation

- MCP setup: https://github.com/Stahldavid/sensegrep/blob/main/docs/mcp-setup.md
- Repository: https://github.com/Stahldavid/sensegrep
