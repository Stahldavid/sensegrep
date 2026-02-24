# Recipe: Cursor

## Option A: Plugin Install (recommended)

The fastest path — installs the MCP server, rules, and skill automatically:

1. Open Cursor Settings > Plugins
2. Search for **sensegrep** in the marketplace
3. Click **Install**

Or via CLI:

```bash
cursor plugin install sensegrep
```

The plugin sets up:
- MCP server (`@sensegrep/mcp`) — provides all sensegrep tools
- Rule (always-on) — teaches Cursor to prefer sensegrep over grep
- Skill — full reference for filters and workflows

For one-click MCP setup without marketplace flow, use:

[Add sensegrep MCP to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=sensegrep&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzZW5zZWdyZXAvbWNwQGxhdGVzdCJdfQ%3D%3D)

To generate/update deeplinks automatically from this repo:

```bash
npm run cursor:install-link
npm run cursor:install-link -- --workspace-root
```

Skip to [Smoke Test](#smoke-test).

## Option B: Manual MCP Setup

### Prerequisites

- Node.js 18+
- `@sensegrep/mcp` installed globally
- Cursor MCP support enabled

### Setup (copy-paste)

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
2. Trigger a tool call for `sensegrep.index` with `action=stats`.
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
