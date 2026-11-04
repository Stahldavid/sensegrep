# Agent Skills

sensegrep ships as an [Agent Skill](https://claude.com/blog/skills) — a portable `SKILL.md`
that teaches an AI coding agent when and how to use sensegrep. The same skill format works
across Claude Code, Cursor, Codex, OpenCode, and other compatible agents.

The thesis stays the same regardless of how the agent talks to sensegrep: AI agents should
not read more code, they should read the right code. sensegrep combines semantic search,
exact matching, and AST-aware structural retrieval to deliver smaller, more relevant
context. A skill helps route conceptual discovery to Sensegrep while leaving known strings and
exhaustive occurrence audits to direct text search.

## Two runtimes: MCP tools vs the CLI

A skill only *instructs* the agent — it does not, by itself, ship a search engine. sensegrep
exposes its engine two ways, and there is one skill for each:

| Skill | Runtime | How the agent calls sensegrep | Needs an MCP server? |
|-------|---------|-------------------------------|----------------------|
| `sensegrep` | MCP tools | `sensegrep_search`, `sensegrep_detect_duplicates`, … tool calls | Yes — shipped by the plugin |
| `sensegrep-cli` | CLI | `sensegrep search "…" --json`, `sensegrep detect-duplicates --json`, … shell commands | No |

Both expose the engine through different interfaces. Compare actual versions, arguments,
configuration and evidence limits rather than assuming every installation is equivalent.

### When to use the MCP skill (`sensegrep`)

Use the MCP path when you install the **plugin** for your agent (Claude Code, Cursor, or
Codex). The plugin bundles the `@sensegrep/mcp` server *and* the MCP skill, so the agent gets
first-class tool calls with structured results. This is the most ergonomic option for
interactive coding assistants.

See [MCP Server Setup](mcp-setup.md) and the per-agent [recipes](recipes/README.md).

For embeddings without paid inference, see [local Ollama setup and WSL access](local-embeddings.md).

### When to use the CLI skill (`sensegrep-cli`)

Use the CLI path when you want sensegrep **without running an MCP server**:

- Terminal-first agents that run shell commands (and may not support MCP at all).
- CI pipelines and non-interactive automation.
- Environments where you'd rather not stand up and maintain an MCP server process.
- Quick, self-contained setup: install `@sensegrep/cli`, install the skill, done.

The agent runs `sensegrep` commands and reads their output (use `--json` for
machine-readable results). This is exactly the path the [CI recipes](recipes/ci-generic.md)
already use.

## Installing the CLI skill

The CLI skill is distributed through the open
[Agent Skills installer](https://github.com/vercel-labs/skills), which drops the `SKILL.md`
into the right per-agent directory (`~/.claude/skills/`, `~/.cursor/skills/`,
`~/.codex/skills/`, and so on):

```bash
npm install -g @sensegrep/cli
npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g
```

Then index a project once and the agent can search it:

```bash
sensegrep index
```

When distributing manually, copy the whole `skills/sensegrep-cli/` folder, including
references, into the selected agent's skill directory. Keep `AGENTS.md` as a short
router; do not paste the command manual into it. Installation and indexing are
explicit setup operations, not a prerequisite for reading this document.

## Installing the MCP skill

The MCP skill ships only inside each plugin. Installing the plugin is what installs both
the MCP server wiring and the MCP-oriented skill:

```bash
# Claude Code
claude plugin marketplace add Stahldavid/sensegrep && claude plugin install sensegrep

# Cursor
cursor plugin install sensegrep

# Codex
codex plugin marketplace add Stahldavid/sensegrep && codex plugin install sensegrep
```

Do not install the MCP skill with `npx skills add`: the public standalone skill path is
reserved for [`sensegrep-cli`](../skills/sensegrep-cli/SKILL.md), which teaches agents to
run the CLI. MCP-oriented skills live in the plugin bundles.

## Which should I pick?

- Using an editor assistant interactively and want the smoothest experience → **plugin (MCP skill)**.
- Running a terminal-first agent, CI, or an agent without MCP support → **CLI skill**.
- Not sure → start with the **CLI skill**: it has the fewest moving parts and works everywhere
  a shell does.

## See also

- [Recipes](recipes/README.md) — per-agent setup (Claude Code, Cursor, Codex, CI)
- [MCP Server Setup](mcp-setup.md) — the MCP runtime
- [CLI Reference](cli-reference.md) — every `sensegrep` command and flag
- [Parallel-Agent Workflows](parallel-agents.md) — sharing one index across concurrent agents

## Maintaining skill distributions

The canonical MCP source is `plugins/sensegrep/skills/sensegrep/`; the CLI source is
`skills/sensegrep-cli/`. After changing the MCP skill or its reference, run
`node scripts/sync-agent-skills.mjs --check`. Use `--write` to intentionally refresh
the Claude/Cursor distribution, then review the exact diff. Installed user skills
and plugin caches are separate consumers; a source edit does not reload them.
