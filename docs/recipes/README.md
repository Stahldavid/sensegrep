# Recipes

Production-ready setup and workflow recipes for common sensegrep usage paths.

## Available Recipes

- [Claude Code](claude-code.md)
- [Cursor](cursor.md)
- [Codex (OpenAI)](codex.md)
- [CI with GitHub Actions](ci-github-actions.md)
- [Generic CI](ci-generic.md)

## Install Options at a Glance

There are two runtimes. **Plugin/MCP** gives the agent sensegrep tools; **CLI skill** teaches
the agent to run the `sensegrep` command-line tool directly (no MCP server needed).

| Platform | Plugin (MCP tools) | CLI skill (no MCP) |
|---|---|---|
| Claude Code | `claude plugin marketplace add Stahldavid/sensegrep && claude plugin install sensegrep` | `npm i -g @sensegrep/cli && npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g` |
| Cursor | `cursor plugin install sensegrep` | `npm i -g @sensegrep/cli && npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g` |
| Codex | `codex plugin marketplace add Stahldavid/sensegrep && codex plugin install sensegrep` | `npm i -g @sensegrep/cli && npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g` |
| Cline / Amp / others | manual MCP setup | `npm i -g @sensegrep/cli && npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g` |

The **plugin** ships the MCP server plus a skill that documents the MCP tools — best when you
want tool calls. The **CLI skill** (`sensegrep-cli`) is self-contained: it needs only
`@sensegrep/cli` and works in any agent that can run shell commands, including CI. See
[Agent Skills](../agent-skills.md) for how the two paths differ.

## What Every Recipe Includes

- Prerequisites
- Copy-paste setup (MCP server + skill)
- Smoke test
- 5-8 practical workflows
- Troubleshooting notes

## Suggested Rollout Order

1. Start with your primary assistant recipe (Claude Code, Cursor, or Codex).
2. Validate one workflow end-to-end.
3. Add CI recipe for repository-wide safety checks.
4. Share the commands internally as a team playbook.
