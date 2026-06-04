# Distribution plan

Ready-to-post drafts for sensegrep launch channels. **Do not post automatically** — review and publish manually.

**Positioning:** sensegrep is semantic grep for AI coding agents (semantic + exact + AST-aware retrieval via CLI and MCP).

**Honesty rules:**

- Say **npm downloads**, not "users", unless you know who they are.
- The project is **early**; ask for feedback.
- Link to [use cases](use-cases.md) and [parallel agents](parallel-agents.md).

---

## Prioritized checklist

| Priority | Action | Owner | Status |
|----------|--------|-------|--------|
| P0 | README hero + traction badges | repo | see PR |
| P0 | `docs/parallel-agents.md` | repo | done |
| P1 | Enable GitHub Discussions + seed threads | David | manual |
| P1 | LinkedIn post 1 (downloads narrative) | David | manual |
| P1 | LinkedIn post 2 (grep vs semantic vs sensegrep) | David | manual |
| P2 | Follow-up email to Luca (parallel agents) | David | manual |
| P2 | Submit to awesome MCP / AI coding lists | David | PRs |
| P3 | Show HN | David | after P0–P1 |
| P3 | Reddit r/ClaudeAI, r/cursor | David | after feedback on LinkedIn |

---

## Hacker News — Show HN

**Title:** Show HN: sensegrep – semantic grep for AI coding agents

**Body:**

I built sensegrep because AI coding agents still struggle to retrieve the right code context.

- **grep/ripgrep** — fast and exact, but only when you know the string.
- **Semantic search** — good for concepts, often noisy and hard to narrow.
- **AST tools** — precise structure, not meaning.

sensegrep combines semantic search, exact matching (`--pattern`), tree-sitter structural filters (30+), AST-aware chunks, tree-shaking, and an MCP server for Claude Code, Cursor, Windsurf, and custom agents.

CLI: `npm i -g @sensegrep/cli`  
MCP: `npx -y @sensegrep/mcp`

Repo: https://github.com/Stahldavid/sensegrep

Early project with npm download traction; I'm trying to learn real agent workflows. Feedback especially welcome on MCP, parallel agents, and large repos.

**Risk:** High scrutiny. README and demo must be clear before posting.

---

## Reddit — r/ClaudeAI

**Title:** Semantic grep for Claude Code / MCP — looking for feedback on sensegrep

**Body:**

I maintain sensegrep (CLI + MCP). It targets a gap I keep hitting with coding agents: keyword grep when you know the symbol, noisy semantic search when you only know the idea.

sensegrep tries to combine both plus AST filters so agents get smaller symbol-level chunks instead of full-file dumps. There's a Claude Code plugin and MCP tools (`search`, `survey`, `cluster`, `index`, `detect_duplicates`).

https://github.com/Stahldavid/sensegrep

Early stage — npm shows download activity but I'm still mapping real workflows. If you use Claude Code with MCP, I'd appreciate feedback on what's missing.

**Risk:** Medium. Be ready to answer setup questions in comments.

---

## Reddit — r/cursor

**Title:** sensegrep MCP + Cursor plugin — semantic + structural code search for agents

**Body:**

Sharing an OSS tool I've been building: sensegrep. Positioning is "semantic grep for AI coding agents" — semantic search + structural filters + exact match, with MCP and a Cursor plugin (marketplace pending in some cases; MCP install link in README).

Useful when agents need to find code by meaning ("where is billing authorization checked?") without dumping entire files.

Repo: https://github.com/Stahldavid/sensegrep  
Parallel agent notes: https://github.com/Stahldavid/sensegrep/blob/main/docs/parallel-agents.md

Looking for feedback from Cursor users on MCP ergonomics and agent workflows.

---

## Reddit — r/LocalLLaMA

**Title:** Code retrieval layer for local / custom coding agents (sensegrep CLI + MCP)

**Body:**

For people running custom agent stacks: sensegrep indexes a repo with tree-sitter + embeddings (Gemini, OpenAI-compatible, or Bedrock) and exposes search via CLI and MCP.

Not a model — a retrieval layer. Combines semantic search with AST filters and smaller chunks for context.

https://github.com/Stahldavid/sensegrep

Early project; honest about npm downloads vs unknown active users. Interested in how you handle code search in local agent setups.

---

## LinkedIn — Post 1 (downloads narrative)

I thought nobody was using my open-source project.

Then I checked npm.

The sensegrep packages (`@sensegrep/cli`, `@sensegrep/mcp`, `@sensegrep/core`) are seeing on the order of **~700 combined downloads per week** across those packages — still early, and downloads ≠ active users, but real signal that people are trying the tooling.

sensegrep is **semantic grep for AI coding agents**: CLI + MCP + structural filters so agents find code by meaning *and* by structure, without always dumping full files into context.

I'm trying to understand who's using it and how — Claude Code, Cursor, Windsurf, custom MCP agents, parallel research workflows.

If that's you, I'd really appreciate feedback or a GitHub star:
https://github.com/Stahldavid/sensegrep

---

## LinkedIn — Post 2 (comparative advantage)

Most AI coding agents still search code in one of two weak ways:

**Keyword search** — fast and precise, but only if the agent already knows the exact name or string.

**Semantic search** — better when the agent knows the idea, but often noisy and hard to constrain.

That's the gap sensegrep targets. It's not "another embedding search box."

It combines:

- semantic search when you know the concept  
- exact matching when you know the identifier  
- AST-aware structural filters for precision  
- symbol-level chunks + tree-shaking instead of full-file dumps  
- MCP so Claude Code, Cursor, Windsurf, and custom agents can use it as a tool  

Example intent: *"Where do we validate user permissions before protected routes?"* — not just `auth` grep.

Thesis: **AI agents should not read more code. They should read the right code.**

https://github.com/Stahldavid/sensegrep

---

## LinkedIn — Post 4 (parallel agents)

One workflow I care about: **parallel AI coding agents** on the same repository.

Split research:

- Agent 1 → authentication  
- Agent 2 → data layer  
- Agent 3 → API routes  
- Agent 4 → frontend state  

The bottleneck is usually shared context: re-indexing, overlapping grep hits, or dumping huge files into every prompt.

sensegrep uses one index per repo, then `search` / `survey` / `cluster` with structural filters so each agent can pull smaller, more relevant slices.

Wrote up the pattern here:
https://github.com/Stahldavid/sensegrep/blob/main/docs/parallel-agents.md

Curious how others handle retrieval across parallel agents.

---

## Direct outreach (DM / email template)

Hi — I'm David, author of sensegrep (semantic grep for AI coding agents — CLI + MCP).

I saw you're working on [ctx / agent orchestration / MCP]. I'm especially interested in how teams handle **code retrieval and shared context when multiple agents search the same repo in parallel**.

If you've tried `@sensegrep/mcp`, I'd love 15 minutes of feedback — what's missing, what's redundant, and whether the MCP tools fit your orchestration model.

No pitch — mostly learning from builders in this space.

Thanks,  
David

---

## Awesome lists — PR template

**Title:** Add sensegrep — semantic grep for AI coding agents (CLI + MCP)

**Body:**

- **Repo:** https://github.com/Stahldavid/sensegrep  
- **npm:** `@sensegrep/cli`, `@sensegrep/mcp`  
- **MCP registry:** `io.github.Stahldavid/sensegrep`  
- **Summary:** Semantic + structural code search with tree-sitter, embeddings, and MCP tools for AI coding assistants (Claude Code, Cursor, Windsurf).

**Category:** [MCP servers / AI coding / code search — pick list-appropriate section]

---

## MCP directories

- Official registry entry via `server.json` (see [week1-launch-checklist.md](week1-launch-checklist.md))
- Verify listing after each `@sensegrep/mcp` release

---

## Manual approval points

- [ ] All posts reviewed for accurate download numbers ([traction.md](traction.md))
- [ ] No false "thousands of users" claims
- [ ] Luca / third parties not named without permission
- [ ] Show HN only after Discussions seeded and README updated
