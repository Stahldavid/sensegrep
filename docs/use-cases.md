# Use cases

sensegrep is **semantic grep for AI coding agents**: semantic search, exact matching, AST-aware structural filters, and smaller code slices for agent context — via [CLI](cli-reference.md) and [MCP](mcp-setup.md).

## Parallel AI coding agents

Split research across agents on the **same repository** and reuse one on-disk index:

| Agent | Focus | Example command |
|-------|--------|-----------------|
| 1 | Authentication | `sensegrep survey "authentication login token" --language typescript --limit 4` |
| 2 | Data layer | `sensegrep survey "database models migrations" --limit 4` |
| 3 | API surface | `sensegrep search "route handlers middleware" --type function --limit 15` |
| 4 | Frontend state | `sensegrep cluster "checkout cart state" --limit 4` |

All agents can point at the same project root. Index once (`sensegrep index --root .`), then search in parallel processes or separate MCP sessions.

See [Parallel agents](parallel-agents.md) for architecture notes and MCP setup.

## Onboarding unfamiliar repositories

Ask by **concept** instead of guessing identifiers:

```bash
sensegrep index --root .
sensegrep search "where user permissions are validated before protected routes" --type function --limit 20
```

Combine with `survey` and `cluster` to build a reading map before editing code.

## Refactoring large codebases

Use structural filters to narrow semantic results:

```bash
sensegrep search "error handling retry" --type function --async --min-complexity 5
sensegrep search "business logic" --min-complexity 10 --has-docs false
```

Tree-shaking collapses irrelevant symbols so agents see **functions and classes**, not whole files.

## Duplicate logic detection

Find cross-file logical duplicates for cleanup tickets:

```bash
sensegrep detect-duplicates --cross-file-only --threshold 0.85 --show-code
```

## MCP as a code retrieval layer

Expose search to Claude Code, Cursor, Windsurf, or custom agents:

```bash
npx -y @sensegrep/mcp
```

Tools include `sensegrep.search`, `sensegrep.survey`, `sensegrep.cluster`, `sensegrep.index`, and `sensegrep.detect_duplicates`. Recipes:

- [Claude Code](recipes/claude-code.md)
- [Cursor](recipes/cursor.md)
- [Windsurf](recipes/windsurf.md)

## CI and shared indexes

Index in CI or on a shared runner so agents and humans share the same semantic index. See [GitHub Actions recipe](recipes/ci-github-actions.md).

## Related docs

- [Case studies](case-studies.md) — reproducible examples on public repos
- [Architecture](architecture.md)
- [Traction](traction.md) — public usage signals (honest metrics)
