# sensegrep Cursor Plugin

Semantic code search plugin for Cursor using the `@sensegrep/mcp` server.

## What it provides

- Rule to prefer semantic search over plain text grep for code exploration
- Skill with practical query patterns and filters
- MCP server wiring to `@sensegrep/mcp@latest`

## Structure

- `.cursor-plugin/plugin.json` - Cursor plugin manifest
- `.mcp.json` - MCP server definition
- `rules/sensegrep.mdc` - Rule guidance
- `skills/sensegrep/SKILL.md` - Agent skill
- `assets/logo.png` - Plugin logo

## Local validation checklist

1. Manifest exists at `.cursor-plugin/plugin.json`
2. Manifest paths are relative and valid
3. Rule file includes frontmatter (`description`, `alwaysApply`)
4. Skill file includes frontmatter (`name`, `description`)
5. Logo path exists and resolves from manifest

## Install in Cursor

Use the marketplace flow, then install plugin `sensegrep`.

If testing manually from a repository checkout, ensure Cursor can access this plugin directory and load `.cursor-plugin/plugin.json`.

## One-click MCP install link

If you only want the MCP server (without installing the full plugin package), use:

[Add sensegrep MCP to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=sensegrep&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzZW5zZWdyZXAvbWNwQGxhdGVzdCJdfQ%3D%3D)

To regenerate/update install links from this repository:

```bash
npm run cursor:install-link
npm run cursor:install-link -- --workspace-root
```

## Manual MCP setup

Manual setup is still supported via `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).

This plugin also ships a ready config at:

- `.mcp.json`
