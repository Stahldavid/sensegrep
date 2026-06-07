# Recipe: Codex (OpenAI)

## Prerequisites

- Node.js 18+
- OpenAI Codex CLI installed (`npm install -g @openai/codex`)
- `@sensegrep/mcp` installed globally

## Setup (plugin — recommended)

The fastest path. sensegrep ships a Codex plugin from the public repository, so you can
install it from the marketplace without editing any config by hand:

```bash
codex plugin marketplace add Stahldavid/sensegrep
codex plugin install sensegrep
```

This wires up the `@sensegrep/mcp` server and installs the skill that teaches Codex when
to prefer semantic search over grep. For manual MCP setup (or other editors), use the
config below instead.

## Setup (manual MCP config)

Install the MCP server:

```bash
npm install -g @sensegrep/mcp
```

If you are not using the plugin and want a standalone skill, install the CLI skill. The
MCP-oriented skill is bundled with the plugin only.

```bash
npm install -g @sensegrep/cli
npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g
```

Wire sensegrep into Codex. Codex reads MCP config from `~/.codex/config.toml` (TOML, not
JSON), and uses `mcp_servers` (underscore). Add it with the CLI:

```bash
codex mcp add sensegrep --env SENSEGREP_ROOT=/absolute/path/to/project -- sensegrep-mcp
```

Or edit `~/.codex/config.toml` manually:

```toml
[mcp_servers.sensegrep]
command = "sensegrep-mcp"
args = []
env = { SENSEGREP_ROOT = "/absolute/path/to/project" }
```

> Codex runs MCP servers locally over stdio, so `sensegrep-mcp` (a local subprocess) is
> exactly the supported shape. Use `mcp_servers` with an underscore — `mcp-servers` will
> not be read.

## Smoke Test

1. Restart Codex (or start a new session) so it picks up the config.
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
  Confirm the config lives at `~/.codex/config.toml` and uses `[mcp_servers.sensegrep]`
  (underscore), then restart Codex.
- Large-repo noise:
  Use `include` filter and lower `limit`.
- First call latency:
  Expected during initial indexing and model warm-up.
