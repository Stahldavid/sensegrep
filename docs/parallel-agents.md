# Parallel AI coding agents

Luca King ([@luca-ctx](https://github.com/luca-ctx)) and others building agent orchestration often ask: **can multiple agents search the same codebase in parallel without each one re-indexing or dumping full files?**

sensegrep is designed for that pattern.

## Problem

Running several agents on one repo usually fails in one of two ways:

1. **Keyword-only search** — each agent greps different strings and opens huge files.
2. **Noisy semantic search** — each agent gets broad, overlapping chunks and blows the context window.

The hard part is not starting multiple agents. It is giving each agent **the right slice of code** from a **shared understanding** of the repo.

## How sensegrep helps

```text
                    ┌─────────────────────┐
                    │  sensegrep index    │
                    │  (once per repo)    │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
   ┌───────────┐         ┌───────────┐         ┌───────────┐
   │  Agent 1  │         │  Agent 2  │         │  Agent 3  │
   │   auth    │         │   API     │         │  frontend │
   └─────┬─────┘         └─────┬─────┘         └─────┬─────┘
         │ survey/search       │ cluster/search      │ search
         ▼                     ▼                     ▼
   smaller AST-aware     subthemes +        filtered symbols
   symbol chunks         reading map        (not full files)
```

1. **Shared index** — `sensegrep index --root .` (or MCP `sensegrep.index`) builds one LanceDB index for the tree.
2. **Partitioned research** — each agent uses `search`, `survey`, or `cluster` on a different theme.
3. **Structural precision** — filters (`--type`, `--exported`, `--language`, `--include`, etc.) reduce overlap between agents.
4. **Tree-shaking** — results favor relevant symbols over entire file dumps.

## CLI example

Index once:

```bash
sensegrep index --root .
```

Agent-style splits (run in separate terminals or jobs):

```bash
# Agent 1 — auth
sensegrep survey "authentication session token middleware" --language typescript --limit 4

# Agent 2 — persistence
sensegrep survey "database model repository migration" --limit 4

# Agent 3 — HTTP surface
sensegrep search "request validation route handler" --type function --limit 15

# Agent 4 — broad theme → subthemes
sensegrep cluster "checkout payment cart order" --limit 4
```

Merge findings at the orchestration layer (your agent framework), not inside sensegrep.

## MCP example

Multiple MCP clients (or parallel tool calls from one orchestrator) can use the same server with `SENSEGREP_ROOT` set to the repository root:

```json
{
  "servers": {
    "sensegrep": {
      "command": "npx",
      "args": ["-y", "@sensegrep/mcp"],
      "env": {
        "SENSEGREP_ROOT": "/path/to/your/repo"
      }
    }
  }
}
```

Optional: `SENSEGREP_WATCH=true` keeps the index fresh when files change (rate-limited reindex). See [mcp-setup.md](mcp-setup.md).

Typical tool split per agent:

| Tool | When to use |
|------|-------------|
| `sensegrep.survey` | Map a domain (auth, billing, infra) |
| `sensegrep.cluster` | Split a vague topic into subthemes |
| `sensegrep.search` | Precise retrieval with filters |
| `sensegrep.detect_duplicates` | Cross-cutting refactor candidates |

## Deduplication across agents

sensegrep does not merge agent outputs automatically. Recommended practices:

- Assign **non-overlapping themes** per agent (`survey`/`cluster` first).
- Use **`--include` / `--exclude` globs** per agent to scope paths.
- Cap **`--limit`** on search to keep slices small.
- Let the orchestrator dedupe file paths and symbol names in final context.

## When this is not enough

You still need an orchestration layer for task planning, patches, and PRs. sensegrep is the **retrieval layer** — semantic + structural + exact — not a multi-agent framework.

## Next steps

- [Use cases](use-cases.md)
- [Claude Code recipe](recipes/claude-code.md)
- [MCP setup](mcp-setup.md)

If you run parallel agents with sensegrep, share your setup in [GitHub Discussions](https://github.com/Stahldavid/sensegrep/discussions) or a [use case issue](https://github.com/Stahldavid/sensegrep/issues/new?template=use_case.yml).
