# sensegrep Codex Plugin

Semantic + structural code search for [OpenAI Codex](https://developers.openai.com/codex)
using `@sensegrep/mcp`. The thesis: AI agents should not read more code, they should read
the right code — sensegrep combines semantic search, exact matching, and AST-aware
structural retrieval to deliver smaller, more relevant context.

## What it provides

- MCP server wiring to `@sensegrep/mcp@1.5.2` (pinned in `.mcp.json`)
- A skill that teaches Codex when to prefer semantic search over grep

## Structure

- `.codex-plugin/plugin.json` — Codex plugin manifest
- `.mcp.json` — MCP server definition
- `skills/sensegrep/SKILL.md` — the core sensegrep skill

## Install

This plugin ships from the public `Stahldavid/sensegrep` repository, which contains a Codex
marketplace at `.agents/plugins/marketplace.json`. Anyone can add it to their personal Codex:

```bash
codex plugin marketplace add Stahldavid/sensegrep
codex plugin install sensegrep
```

## Tools exposed

- `sensegrep_search` — semantic + structural code search (primary tool)
- `sensegrep_survey` — build a reading map across a broad theme
- `sensegrep_cluster` — split a broad topic into coherent subthemes
- `sensegrep_detect_duplicates` — find logical duplicate code across files
- `sensegrep_index` — create/update the semantic index or fetch index stats

## Local validation checklist

1. Manifest exists at `.codex-plugin/plugin.json` with `name` matching the folder.
2. Manifest component paths are relative and start with `./`.
3. `.mcp.json` exists and points to a pinned `@sensegrep/mcp` version.
4. The marketplace entry at `.agents/plugins/marketplace.json` points to `./plugins/sensegrep`.
5. Plugin install smoke test succeeds in Codex.
