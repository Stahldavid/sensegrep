# Recipe: Claude Code

## Option A: Plugin Install (recommended)

The fastest path — installs the MCP server and teaches Claude how to use sensegrep automatically:

```bash
claude plugin marketplace add Stahldavid/sensegrep
claude plugin install sensegrep
```

That's it. Claude now has access to all sensegrep tools and knows when to prefer them over grep. Skip to [Smoke Test](#smoke-test).

> Explicit marketplace form also works:
> ```bash
> claude plugin install sensegrep@sensegrep
> ```

## Option B: Skill Only (no plugin)

If you already have the MCP server configured and only want the skill (the guidance that tells Claude when and how to use sensegrep):

```bash
npx skills add Stahldavid/sensegrep -g
```

This installs the skill globally for Claude Code. The skill teaches Claude to prefer `sensegrep_search` over grep for code exploration, how to combine filters and patterns, and when to use each search strategy.

> You still need the MCP server running. See [Option C](#option-c-manual-mcp-setup) if you haven't set it up yet.

## Option C: Manual MCP Setup

### Prerequisites

- Node.js 18+
- `@sensegrep/mcp` installed globally
- Claude Code MCP enabled

### Setup (copy-paste)

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
2. Ask Claude to call `sensegrep.index` with `action=stats`.
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
