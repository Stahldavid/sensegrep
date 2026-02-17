# Recipe: Claude Code

## Prerequisites

- Node.js 18+
- `@sensegrep/mcp` installed globally
- Claude Code MCP enabled

## Setup (copy-paste)

Install:

```bash
npm install -g @sensegrep/mcp
```

Add to `~/.claude.json` (or project `.claude.json`):

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

1. Open the project in Claude Code.
2. Ask Claude to call `sensegrep.languages` and `sensegrep.stats`.
3. Confirm tools return structured output without errors.

## Practical Workflows

1. Intent discovery:
   Ask for `sensegrep.search` with query: `authentication and token validation`.
2. Async risk scan:
   Use `isAsync=true` with `minComplexity=4`.
3. Refactor scoping:
   Filter by `parentScope` to inspect a specific service/class.
4. Duplicate triage:
   Call `sensegrep.detect_duplicates` with `crossFileOnly=true`.
5. Language split:
   Use `language=python` or `language=typescript` for targeted analysis.
6. Regex post-filter:
   Add `pattern` when narrowing semantic hits (`retry|backoff|timeout`).

## Troubleshooting

- No tools visible:
  Verify JSON syntax and restart Claude Code.
- Empty results:
  Confirm `SENSEGREP_ROOT` points to the repository root.
- Slow first query:
  First call may trigger indexing/model load.
