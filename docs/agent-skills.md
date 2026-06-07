# Agent Skills

sensegrep ships as an [Agent Skill](https://claude.com/blog/skills) — a portable `SKILL.md`
that teaches an AI coding agent when and how to use sensegrep. The same skill format works
across Claude Code, Cursor, Codex, OpenCode, and other compatible agents.

The thesis stays the same regardless of how the agent talks to sensegrep: AI agents should
not read more code, they should read the right code. sensegrep combines semantic search,
exact matching, and AST-aware structural retrieval to deliver smaller, more relevant
context. A skill is what makes the agent reach for sensegrep instead of grep in the first
place.

## Two runtimes: MCP tools vs the CLI

A skill only *instructs* the agent — it does not, by itself, ship a search engine. sensegrep
exposes its engine two ways, and there is one skill for each:

| Skill | Runtime | How the agent calls sensegrep | Needs an MCP server? |
|-------|---------|-------------------------------|----------------------|
| `sensegrep` | MCP tools | `sensegrep_search`, `sensegrep_detect_duplicates`, … tool calls | Yes — shipped by the plugin |
| `sensegrep-cli` | CLI | `sensegrep search "…" --json`, `sensegrep detect-duplicates --json`, … shell commands | No |

Both deliver the same retrieval quality. The difference is purely the interface the agent
uses.

### When to use the MCP skill (`sensegrep`)

Use the MCP path when you install the **plugin** for your agent (Claude Code, Cursor, or
Codex). The plugin bundles the `@sensegrep/mcp` server *and* the MCP skill, so the agent gets
first-class tool calls with structured results. This is the most ergonomic option for
interactive coding assistants.

See [MCP Server Setup](mcp-setup.md) and the per-agent [recipes](recipes/README.md).

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

If you prefer not to use the installer, you can also paste the contents of
[`skills/sensegrep-cli/SKILL.md`](../skills/sensegrep-cli/SKILL.md) into your agent's
instructions file (for example `AGENTS.md`) — the skill body is plain Markdown guidance plus
the exact commands.

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
