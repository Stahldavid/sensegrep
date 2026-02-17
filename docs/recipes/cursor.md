# Recipe: Cursor

## Prerequisites

- Node.js 18+
- `@sensegrep/mcp` installed globally
- Cursor MCP support enabled

## Setup (copy-paste)

Install:

```bash
npm install -g @sensegrep/mcp
```

Add to Cursor MCP configuration:

```json
{
  "mcpServers": {
    "sensegrep": {
      "command": "sensegrep-mcp",
      "env": {
        "SENSEGREP_ROOT": "/absolute/path/to/project"
      }
    }
  }
}
```

## Smoke Test

1. Restart Cursor.
2. Trigger a tool call for `sensegrep.languages`.
3. Trigger a tool call for `sensegrep.search` with a short query.

## Practical Workflows

1. Find onboarding entry points:
   Query `request lifecycle and middleware`.
2. Audit complex hotspots:
   Query with `minComplexity=8`.
3. Locate exported APIs:
   Set `isExported=true` and `symbolType=function`.
4. Python model discovery:
   Set `language=python` and `variant=dataclass`.
5. Duplicate review queue:
   Run `sensegrep.detect_duplicates` and save top groups as tasks.
6. Targeted include scope:
   Use `include=src/**/*.ts` to avoid generated/vendor code.

## Troubleshooting

- MCP server fails to start:
  Confirm `sensegrep-mcp` is available in PATH.
- Unexpected project scanned:
  Check `SENSEGREP_ROOT` value and absolute path usage.
- Results too broad:
  Add filters incrementally (`symbolType`, `language`, `minComplexity`, `pattern`).
