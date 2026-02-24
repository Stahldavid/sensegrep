# Recipe: Windsurf

## Prerequisites

- Node.js 18+
- `@sensegrep/mcp` installed globally
- Windsurf MCP configuration support

## Setup (copy-paste)

Install:

```bash
npm install -g @sensegrep/mcp
```

Add to Windsurf MCP config:

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

1. Reload Windsurf.
2. Invoke `sensegrep.index` with `action=stats`.
3. Invoke `sensegrep.search` with query `error handling`.

## Practical Workflows

1. Identify stabilization paths:
   Query `retry and fallback behavior`.
2. Refactor guardrails:
   Filter `symbolType=method` and `minComplexity=6`.
3. Import-focused audits:
   Use `imports` filter to inspect usage of sensitive dependencies.
4. Parent-scope drill-down:
   Use `parentScope` to isolate one class/module.
5. Duplicate debt review:
   Run duplicates with `crossFileOnly=true` and `showCode=true`.
6. Multilingual workspace checks:
   Run the same query across `typescript` then `python`.

## Troubleshooting

- No output from tool calls:
  Verify MCP JSON syntax and restart Windsurf.
- Large-repo noise:
  Use `include` filter and lower `limit`.
- First call latency:
  Expected during initial indexing and model warm-up.
