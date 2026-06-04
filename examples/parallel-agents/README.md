# Parallel agents example

One shared index, multiple research themes. See [docs/parallel-agents.md](../../docs/parallel-agents.md) for architecture and MCP notes.

## Prerequisites

```bash
npm i -g @sensegrep/cli
export GEMINI_API_KEY="your_key"   # or another supported provider
cd /path/to/your/repo
sensegrep index --root .
```

## Split research (run in separate terminals)

```bash
# Theme 1 — authentication
sensegrep survey "authentication session token middleware" --limit 4

# Theme 2 — persistence
sensegrep survey "database model repository migration" --limit 4

# Theme 3 — HTTP / API
sensegrep search "request validation route handler" --type function --limit 15

# Theme 4 — decompose a broad product area
sensegrep cluster "checkout payment cart order" --limit 4
```

Merge results in your orchestrator (task planner, lead agent, or human review). sensegrep does not deduplicate across agents automatically — scope each agent with `--include` / `--exclude` when paths overlap.

## MCP

Point multiple clients at the same repo with `SENSEGREP_ROOT`. See [docs/mcp-setup.md](../../docs/mcp-setup.md).
