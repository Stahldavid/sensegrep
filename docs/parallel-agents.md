# Parallel-Agent Workflows

This page describes how to run sensegrep when several AI coding agents work concurrently against a single codebase — the kind of multi-agent setup where one agent fixes a bug while another writes tests and a third refactors a module, all on the same repository at the same time. Agents can reach sensegrep two ways: through the **`@sensegrep/mcp`** server (tool calls) or through the **`@sensegrep/cli`** (shell commands, no MCP server). Both share one on-disk index; most of this page uses the MCP server, and the [CLI-based agents](#cli-based-agents-no-mcp-server) section covers the command-line path.

sensegrep's thesis is that AI agents should not read more code, they should read the right code — combining semantic search, exact matching, and AST-aware structural retrieval to deliver smaller, more relevant context. That thesis matters most in parallel workflows: when many agents share one repo, the scarce resource is each agent's context window, and having every agent grep and read its own line ranges (or rank files with built-in semantic search and open each one) is exactly what slows the whole system down.

For first-time setup, see the [MCP Server Setup](mcp-setup.md) guide for the MCP path or [Agent Skills](agent-skills.md) for the CLI path. This page assumes sensegrep is already installed and focuses on the concurrency-specific concerns.

## The shape of a parallel-agent setup

A typical parallel-agent product spawns multiple agent processes (or sessions) that each hold their own conversation, plan, and tool calls, but operate on one shared working copy of a codebase. Each agent connects to an MCP server to retrieve code. There are two common topologies:

- **One shared server, many agents.** A single `@sensegrep/mcp` process points at the repository root, and every agent issues `sensegrep.search` / `sensegrep.index` calls against it. The semantic index is built once and reused, so the embedding work and the file watch are shared across all agents.
- **One server per agent, same root.** Each agent launches its own `@sensegrep/mcp` process, all configured with the same `SENSEGREP_ROOT`. This isolates agents from one another at the process level while still searching the same code.

Both work. The shared-server topology is the more efficient default because indexing and reindexing happen once rather than once per agent; the per-agent topology trades that efficiency for stronger isolation. The config values described below let you pick the right trade-off.

## Why this delivers smaller, more relevant context per agent

In a parallel workflow the failure mode is context dilution: each agent burns its budget reading line ranges that are merely nearby instead of the symbols that are actually relevant to its task. sensegrep counters this directly.

- **Each query returns a focused result set, not a directory dump.** `sensegrep.search` ranks by semantic meaning, narrows with exact matching, and uses AST-aware structural retrieval to return whole symbols (functions, classes, methods) rather than arbitrary line windows. An agent asked to "find where retry backoff is configured" gets the handful of symbols that implement it, not every file that mentions "retry".
- **Per-agent queries stay scoped to per-agent intent.** Because each agent phrases its own query, the testing agent retrieves test scaffolding and the refactoring agent retrieves the call sites it needs — from the same index, but each receiving the right code for its task rather than more code.
- **Structural filters shrink results further.** Filters such as `symbolType`, `isExported`, `language`, and `parentScope` let an agent ask for exactly the kind of symbol it needs, so the returned context is smaller and more relevant before it ever reaches the model.

The net effect across many concurrent agents is that the shared context budget is spent on signal. Every agent reads the right code, not more code, which is what keeps a multi-agent system fast and coherent as the number of concurrent agents grows.

## Concurrency-affecting configuration

Two environment variables have the largest impact on how `@sensegrep/mcp` behaves under concurrency. Both are documented in full in [MCP Server Setup](mcp-setup.md#environment-variables); their concurrency implications are below.

### `SENSEGREP_ROOT`

The root directory to index and search (defaults to the current working directory).

In a parallel-agent setup this value decides whether agents **share** an index or each maintain their own:

- Point every agent (or the single shared server) at the **same** `SENSEGREP_ROOT` so they all search one codebase from one semantic index. This is the usual choice when all agents collaborate on the same repository — the index is built once and every agent's query benefits from it.
- Give agents **different** `SENSEGREP_ROOT` values only when they genuinely operate on different trees (for example separate worktrees or checkouts). Distinct roots mean distinct indexes, distinct watch scopes, and no cross-talk between agents.

Set it explicitly in each agent's MCP server `env` block rather than relying on the working directory, so concurrent agents launched from different cwds still resolve to the intended codebase.

### `SENSEGREP_WATCH`

Enables file watching (`1` by default; set to `0`, `false`, `off`, or `no` to disable).

File watching is what keeps the index fresh while agents are actively editing the shared codebase. When enabled, the server reindexes at most once per minute after it detects changes, so concurrent edits from several agents are folded into a single incremental reindex rather than triggering a storm of rebuilds. Guidance for parallel workflows:

- **Keep watching on (`SENSEGREP_WATCH=1`) for a shared server** so that edits made by one agent become searchable for the others without a manual reindex.
- **Run exactly one watcher per `SENSEGREP_ROOT`.** If you adopt the one-server-per-agent topology against a shared root, set `SENSEGREP_WATCH=0` on all but one server so a single watcher owns reindexing for that tree and the others avoid redundant filesystem watches and overlapping reindex work.
- **Disable watching (`SENSEGREP_WATCH=0`) for read-only or ephemeral agents** — for example short-lived analysis agents that never edit files. They can rely on an explicit `sensegrep.index` call (or the shared watcher) and skip the watch overhead entirely.

## Putting it together

A common, efficient configuration is a single shared `@sensegrep/mcp` server with watching enabled, plus any number of read-only agents that connect to it with watching disabled:

```json
{
  "mcpServers": {
    "sensegrep": {
      "command": "sensegrep-mcp",
      "env": {
        "SENSEGREP_ROOT": "/path/to/your/project",
        "SENSEGREP_WATCH": "1"
      }
    }
  }
}
```

Each connected agent then issues its own scoped `sensegrep.search` calls against this one index. The index and the file watch are paid for once; every agent receives a small, relevant slice of the codebase tuned to its own task. As you add agents, you are adding queries against a shared index — not duplicating the cost of grepping and re-reading line ranges across the repository per agent.

## CLI-based agents (no MCP server)

Not every agent in a parallel fleet speaks MCP. Terminal-first agents, CI jobs, and agents
without MCP support can share the same codebase index through the `@sensegrep/cli` instead —
the [CLI skill](agent-skills.md) (`sensegrep-cli`) teaches them to do exactly this.

The model is the same "shared index, per-agent query" pattern, just over the command line:

- **Index once.** Run `sensegrep index` against the repository root (or keep one
  `sensegrep index --watch` process running so the on-disk index stays fresh as agents edit).
- **Query per agent.** Each agent runs its own `sensegrep search "…" --json` (or
  `sensegrep detect-duplicates --json`) against that shared index and parses the structured
  output. The index on disk is read concurrently, so there is no server to coordinate.
- **Mix freely.** CLI-based agents and MCP-based agents can run side by side against the same
  `SENSEGREP_ROOT`; they read the same index, just through different interfaces.

This keeps the thesis intact for agents that never touch MCP: each one still pulls a small,
symbol-level slice tuned to its task instead of grepping and re-reading line ranges. The
[`SENSEGREP_ROOT`](#sensegrep_root) and [`SENSEGREP_WATCH`](#sensegrep_watch) guidance above
applies to the CLI too — point every agent at the same root, and let a single `--watch`
process own reindexing for that tree.

## Next steps

- [Agent Skills](agent-skills.md) — the MCP vs CLI skill paths for AI agents
- [MCP Server Setup](mcp-setup.md) — installation, full environment-variable reference, and available tools
- [Recipes](recipes/README.md) — end-to-end setup and workflow playbooks for Claude Code, Cursor, and Codex
