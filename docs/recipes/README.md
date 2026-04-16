# Recipes

Production-ready setup and workflow recipes for common sensegrep usage paths.

## Available Recipes

- [Claude Code](claude-code.md)
- [Cursor](cursor.md)
- [Windsurf](windsurf.md)
- [CI with GitHub Actions](ci-github-actions.md)
- [Generic CI](ci-generic.md)

## Install Options at a Glance

| Platform | Plugin setup | Skill only |
|---|---|---|
| Claude Code | `claude plugin marketplace add Stahldavid/sensegrep && claude plugin install sensegrep` | `npx skills add Stahldavid/sensegrep -g` |
| Cursor | `cursor plugin install sensegrep` | `npx skills add Stahldavid/sensegrep -g` |
| Windsurf / Cline / Amp / others | manual MCP setup | `npx skills add Stahldavid/sensegrep -g` |

The skill alone is enough if the MCP server is already wired up — it gives the agent the guidance on when and how to use sensegrep tools.

## What Every Recipe Includes

- Prerequisites
- Copy-paste setup (MCP server + skill)
- Smoke test
- 5-8 practical workflows
- Troubleshooting notes

## Suggested Rollout Order

1. Start with your primary assistant recipe (Claude Code, Cursor, or Windsurf).
2. Validate one workflow end-to-end.
3. Add CI recipe for repository-wide safety checks.
4. Share the commands internally as a team playbook.
