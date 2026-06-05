# Use Cases

sensegrep is semantic grep for AI coding agents. Its thesis is simple: **AI agents should not read more code, they should read the right code** — sensegrep combines semantic search, exact matching, and AST-aware structural retrieval to deliver smaller, more relevant context to the agent.

This page collects concrete scenarios where that matters. Each one names the agent environment it targets, shows the kind of query that does the work, explains how sensegrep sharpens or shrinks the context the agent receives, and links to the matching setup recipe under [`docs/recipes/`](recipes/README.md).

Every scenario assumes the MCP server (`@sensegrep/mcp`) is wired into the agent and the index is built; the [recipes](recipes/README.md) cover that setup per environment. The same retrieval is available on the command line through `@sensegrep/cli` and as a library through `@sensegrep/core`.

## How to read these scenarios

- **Environment** — the AI coding agent the scenario targets (Claude Code, Cursor, or Codex).
- **The problem** — where today's agent retrieval (grep or built-in semantic search, then reading a selected line range) still hands the model the wrong slice.
- **With sensegrep** — the query or filter that narrows the search to the right code.
- **Why it's the right code, not more code** — how the result reduces or sharpens the context handed to the agent.
- **Recipe** — the environment-specific setup and workflow document.

---

## Scenario 1 — Intent discovery before a change (Claude Code)

**Environment:** Claude Code, using the sensegrep tools exposed over `@sensegrep/mcp`.

**The problem:** A request like "tighten up how we validate auth tokens" sends a keyword-first agent grepping for strings like `token` or `validate`, then reading selected line ranges around each hit. Those terms appear in logging, tests, config, and comments, so the agent fans out across many files and still has to guess which line ranges implement the behavior. Built-in semantic search helps rank files, but the agent still reads line windows that straddle unrelated symbols.

**With sensegrep:** The agent calls `sensegrep.search` with an intent query — `authentication and token validation` — instead of a literal string. Semantic ranking surfaces the functions that actually implement validation, exact matching keeps a known symbol or error string anchored, and AST-aware retrieval returns whole symbols (the function and its signature) rather than stray lines. The agent can layer a regex `pattern` such as `retry|backoff|timeout` to narrow further.

**Why it's the right code, not more code:** Instead of grepping a keyword and reading a line range around each of many hits, Claude Code receives the handful of structurally complete symbols that implement the behavior. The delivered context is smaller and more relevant, so the model spends its window reasoning about the change rather than triaging matches and re-reading line windows.

**Recipe:** [`docs/recipes/claude-code.md`](recipes/claude-code.md) — plugin install, manual MCP setup, smoke test, and the intent-discovery workflow.

---

## Scenario 2 — Scoping a refactor to one module (Cursor)

**Environment:** Cursor, with the sensegrep rule and MCP server installed so the agent prefers semantic retrieval over `grep`.

**The problem:** Refactors leak. Asked to change one service, an agent that searches by keyword (or ranks files with built-in semantic search) keeps finding same-named helpers in unrelated modules, then reads line ranges from each to disambiguate. It either edits the wrong one or pulls in many extra line windows to be safe. Both outcomes waste context and invite mistakes.

**With sensegrep:** The agent constrains retrieval structurally — `parentScope` to isolate a single service or class, `symbolType=function` with `isExported=true` to find the public surface, and `include=src/**/*.ts` to skip generated and vendor code. Complexity filters like `minComplexity=8` point straight at the hotspots worth refactoring first.

**Why it's the right code, not more code:** AST-aware filters mean Cursor sees only the symbols inside the target scope, not every textual collision across the tree. The context handed to the agent is bounded to the module under change, which sharpens the edit and keeps the blast radius small.

**Recipe:** [`docs/recipes/cursor.md`](recipes/cursor.md) — marketplace install, one-click MCP deeplink, smoke test, and the refactor-scoping workflow.

---

## Scenario 3 — Auditing error and stabilization paths (Codex)

**Environment:** Codex (OpenAI), with `@sensegrep/mcp` configured in `~/.codex/config.toml` and the skill installed to guide tool use.

**The problem:** "Where do we handle failures?" is a semantic question with no single keyword. Retry logic, fallbacks, and timeouts are spread across modules and named inconsistently, so a literal grep misses most of them; even built-in semantic search returns ranked files the agent must open and read line range by line range, stitching together a picture from partial windows.

**With sensegrep:** The agent queries by behavior — `retry and fallback behavior` or `error handling` — and adds structural filters such as `symbolType=method` with `minComplexity=6` to focus on the non-trivial paths. In a multilingual workspace it runs the same query across `language=typescript` then `language=python` to compare how each side handles failure.

**Why it's the right code, not more code:** Semantic retrieval gathers the conceptually related error paths even when they share no common token, and AST awareness returns them as complete units instead of arbitrary line windows. Codex gets a tight, relevant slice of the stabilization surface instead of a wide, noisy read — smaller context, sharper audit.

**Recipe:** [`docs/recipes/codex.md`](recipes/codex.md) — TOML MCP config, skill install, smoke test, and the stabilization-audit workflow.

---

## Scenario 4 — Repository-wide guardrails in CI (any agent environment)

**Environment:** Continuous integration, or any terminal-first agent that runs shell commands — the same retrieval an agent uses interactively, run non-interactively through `@sensegrep/cli` (no MCP server required; see the [CLI skill](agent-skills.md)).

**The problem:** Agent-authored changes can quietly reintroduce duplicate logic or sprawling complexity that a line-diff review misses. Without a structural signal, the only way to catch it is to ask a reviewer (human or agent) to read large diffs in full.

**With sensegrep:** A CI step runs `sensegrep detect-duplicates --cross-file-only --json` and complexity-scoped `sensegrep search` calls to flag new hotspots. The findings become a short, structured report — exactly the kind of small, targeted context an agent can act on in a follow-up pass.

**Why it's the right code, not more code:** CI surfaces only the specific symbols that regressed, so whatever agent picks up the follow-up reads those symbols rather than the whole diff. The structural signal keeps the delivered context minimal and on-point.

**Recipe:** [`docs/recipes/ci-github-actions.md`](recipes/ci-github-actions.md) for GitHub Actions, or [`docs/recipes/ci-generic.md`](recipes/ci-generic.md) for other CI systems.

---

## Where to go next

- Browse all environment setups in the [recipes index](recipes/README.md).
- For how agents talk to sensegrep (MCP tools vs the CLI skill), see [`docs/agent-skills.md`](agent-skills.md).
- For concurrent multi-agent workflows on one codebase, see [`docs/parallel-agents.md`](parallel-agents.md).

Using sensegrep in a workflow that isn't listed here? Open a [use-case issue](../.github/ISSUE_TEMPLATE/use_case.yml) and tell us how — concrete scenarios are what make this page better.
