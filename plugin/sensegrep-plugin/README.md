# sensegrep Claude Code Plugin

Semantic code search plugin for Claude Code using `@sensegrep/mcp`.

## What it provides

- MCP server wiring to `@sensegrep/mcp@0.1.19`
- Skill that teaches when to prefer semantic search over grep
- Slash commands for common search flows
- A focused code exploration subagent

## Structure

- `.claude-plugin/plugin.json` - Claude plugin manifest
- `.mcp.json` - MCP server definition
- `skills/sensegrep/SKILL.md` - Core sensegrep skill
- `commands/` - Slash commands
- `agents/` - Subagent definitions

## Included Commands

- `/sensegrep-find` - semantic search with optional filters
- `/sensegrep-duplicates` - detect logical duplicates across files
- `/sensegrep-health` - verify index state and language support

## Local validation checklist

1. Manifest exists at `.claude-plugin/plugin.json`
2. Manifest paths are relative and valid
3. `.mcp.json` exists and points to a pinned MCP version
4. `commands/` and `agents/` files load without frontmatter errors
5. Plugin install smoke test succeeds in Claude Code

## Install

```bash
claude plugin marketplace add Stahldavid/sensegrep
claude plugin install sensegrep
```

If marketplace is already configured, this explicit form also works:

```bash
claude plugin install sensegrep@sensegrep
```
