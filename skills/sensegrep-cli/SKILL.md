---
name: sensegrep-cli
description: Use Sensegrep for semantic code discovery, index inspection, or structural queries when they help the task. Use direct text search for known strings and exhaustive occurrences.
---

# Sensegrep CLI

## Choose the operation

- Known path, identifier, string or complete occurrence audit: use `rg`/`rg --files`, or `sensegrep literal --filesystem --json` when its structured evidence is useful. No semantic index is needed.
- Uncertain implementation location or conceptual behavior: use `sensegrep search` with a focused query; inspect selected results in source.
- A bounded context pack or broad reading map: use `context`, `survey` or `cluster`. Load only the relevant section of the [command guide](references/command-guide.md).
- Reference/rename completeness: use compiler-aware references or AST/LSP evidence. Semantic retrieval is discovery, not an exhaustive dependency graph.

## Execution and privacy

Use an existing CLI or the MCP tools actually exposed in this consumer; a skill alone does not install or start either. Check the executable version/help when syntax or capabilities matter. Resolve the actual project root and preserve its current configuration.

Reading the skill does not require installation, indexing, model downloads, a daemon or a watcher. If a semantic index is missing, use available source/text evidence; build an index only when that work is in scope. Indexing writes local data and may call an embedding provider. Do not clear or rebuild indexes as automatic recovery.

For local-only retrieval, verify the resolved provider/model/endpoint. In runtimes that support it, `SENSEGREP_NETWORK_POLICY=local-only` disables Jev and remote embedding/capability endpoints and automatic ripgrep downloads. This is application policy, not an OS sandbox. `--jev off` disables remote evaluation for the command. Do not enable source transmission or paid provider calls without task consent. MCP may start watching files; do not start it just to inspect source.

## Evidence and continuation

Prefer compact JSON cards, then `show` for selected IDs. Retain retrieval mode/universe, index identity, budgets, freshness and warnings. Truncation and incomplete coverage limit claims of absence; expand only missing evidence. Ranking/confidence and answer-sufficiency heuristics are not calibrated probabilities or proof of completeness.

Resume cursors are bound to the index snapshot, query and filters; restart discovery if those inputs changed. Distinguish omitted output from unscanned candidates. Report actual CLI wall time separately from internal retrieval metrics.

## References by task

- [Command guide](references/command-guide.md): CLI flags, compact-output handling, search/context, duplicate detection, indexing and provider benchmarks. Examples illustrate operations; they do not authorize setup or remote calls.
- Read `sensegrep --help` and the selected subcommand help for the installed version before relying on newer source capabilities. Preserve deployment-specific notes in the installed guide.
