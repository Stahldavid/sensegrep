---
name: sensegrep
description: Use the exposed Sensegrep MCP tools for semantic discovery and structural evidence when relevant to the task.
---

# Sensegrep MCP

Use the tools exposed by the active MCP server; this skill does not start or install it.

## Select the evidence

- Exact strings, paths and exhaustive occurrences: use direct text tools or `sensegrep_literal` with filesystem mode when supported.
- Conceptual discovery: use `sensegrep_search`; inspect selected cards with `sensegrep_show` and verify in source.
- Broad themes: use survey/cluster/context only when a bounded reading map helps. Load the [tool reference](references/tool-reference.md) for the selected operation and use actual tool schemas as authority.
- Refactor impact or completeness: use compiler-aware references in addition to discovery results.

## Scope and effects

Do not index, install, download models, start services or change provider configuration merely because this skill loaded. Indexing writes state and may call providers. Confirm local-only policy and resolved endpoints for private/local requests; Jev source evaluation is a separate transmission from embeddings and needs applicable consent. Use local-only policy/disabled evaluation when the runtime supports it; do not imply the skill configures the server.

Keep result IDs, snapshot identity, retrieval mode/universe, budget, truncation and warnings. Resume only with the matching snapshot/query/filters. Scores and graph coverage are heuristics, not exhaustive proof. Read only enough source to support the claim, expanding when evidence is incomplete.

## Distribution

The canonical MCP skill is `plugins/sensegrep/skills/sensegrep` in the source repository. Its Claude and Cursor distributions are copied by `scripts/sync-agent-skills.mjs`; use `--check` to verify and `--write` only when intentionally refreshing those package files. CLI and MCP references use different argument names and remain separate.
