# Traction

sensegrep is early-stage. Public signals below are updated manually from npm and GitHub APIs. **Downloads are not the same as active users** — many installs come from `npx`, CI, or one-off trials.

## How to refresh

```bash
# Weekly downloads (per package)
curl -s "https://api.npmjs.org/downloads/point/last-week/@sensegrep/cli" | jq .downloads
curl -s "https://api.npmjs.org/downloads/point/last-week/@sensegrep/mcp" | jq .downloads
curl -s "https://api.npmjs.org/downloads/point/last-week/@sensegrep/core" | jq .downloads

# GitHub
gh repo view Stahldavid/sensegrep --json stargazerCount,forkCount,openIssues
```

## Snapshot (2026-06-04)

| Signal | Value | Notes |
|--------|------:|-------|
| `@sensegrep/cli` weekly downloads | ~200 | npm registry |
| `@sensegrep/mcp` weekly downloads | ~250 | npm registry |
| `@sensegrep/core` weekly downloads | ~255 | npm registry |
| Combined weekly (cli + mcp + core) | **~700** | Sum of packages above |
| Typical monthly downloads per package | ~1.6k–1.9k | Varies by release cadence |
| GitHub stars | check badge / `gh repo view` | Social proof for visitors |
| Published npm version | 1.5.2 | `@sensegrep/cli`, `core`, `mcp` |
| MCP registry | `io.github.Stahldavid/sensegrep` | See `server.json` |
| Integrations | Claude Code plugin, Cursor plugin, VS Code, MCP | See [README](../README.md) |

## What we are optimizing for

1. **Real workflows** — agents, MCP, large repos, parallel research (see [use cases](use-cases.md)).
2. **Honest feedback** — GitHub Discussions and [use case issues](https://github.com/Stahldavid/sensegrep/issues/new?template=use_case.yml).
3. **Repeatable outcomes** — [case studies](case-studies.md) and integration [recipes](recipes/README.md).

If sensegrep helps your agent workflow, a GitHub star and a short note about your setup help others discover the project.
