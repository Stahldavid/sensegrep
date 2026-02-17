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
      "command": "sensegrep-mcp",
      "env": {
        "SENSEGREP_ROOT": "/path/to/project"
      }
    }
  }
}
```

## Tools

- `sensegrep.search`
- `sensegrep.index`
- `sensegrep.stats`
- `sensegrep.detect_duplicates`
- `sensegrep.languages`

## Documentation

- MCP setup: https://github.com/Stahldavid/sensegrep/blob/main/docs/mcp-setup.md
- Repository: https://github.com/Stahldavid/sensegrep
