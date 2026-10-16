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

Both expose the retrieval engine through different interfaces. Installed versions, index identity, filters and budgets determine the evidence returned; compare those before treating outputs as equivalent.

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

The standalone source is [skills/sensegrep-cli/SKILL.md](../skills/sensegrep-cli/SKILL.md). The [Agent Skills installer](https://github.com/vercel-labs/skills) can install it for supported agents. Destination and discovery rules depend on the installed host/version; use that host's supported mechanism. The examples below install software and a skill; they are setup actions, not prerequisites to run automatically during a read-only audit:

```bash
npm install -g @sensegrep/cli
npx skills add Stahldavid/sensegrep --skill sensegrep-cli -g
```

When index writes and the resolved embedding provider are authorized, index once and exit before searching. Confirm provider/model/endpoint with ordinary `selftest` and handle Jev separately as described in [Jev](jev.md):

```bash
sensegrep index --no-watch
```

Keep `AGENTS.md` to durable rules and a short routing pointer; do not paste the full skill body into it. For example:

> For semantic discovery, read the sensegrep CLI skill when available. For exact or exhaustive text evidence, use literal/filesystem search and verify the evidence universe. Read only the relevant CLI, Jev or chunking reference before operations with those effects.

A repository skill file, a marketplace entry marked AVAILABLE, an installed bundle, an exposed tool and a skill actually selected by the consumer are different states. Confirm the current consumer's catalog and tool exposure before claiming availability. A missing skill/tool is a limitation; use already available tools or report it. Do not install, change discovery, start MCP/watch, or index merely to validate a document.

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

## Distribution sources

The standalone CLI skill lives under `skills/sensegrep-cli/`. MCP skill sources are host-specific bundles:

- Claude Code: `plugin/sensegrep-plugin/skills/sensegrep/SKILL.md`
- Cursor: `plugin/sensegrep-cursor/skills/sensegrep/SKILL.md`
- Codex: `plugins/sensegrep/skills/sensegrep/SKILL.md`

Plugin manifests select their own `./skills` directory. The bodies differ by host; do not overwrite one with another. `scripts/sync-versions.mjs` synchronizes versions/manifests and MCP pins, not SKILL bodies. `build.js` copies the separate core tool prompt to dist; it is not a skill generator. No common SKILL body generator is identified here.

The CLI skill links to versioned repository documentation because external `../../docs` paths would not survive installing only the skill directory. Keep references reachable in that distribution.

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

## Cursor Cloud embeddings

Indexing and semantic search use embedding APIs, including a local Ollama server. With no explicit provider or hosted API credentials, the default is Ollama (`qwen3-embedding:0.6b`, 1024 dimensions). CI does **not** configure providers.

### Bedrock example for an existing Cursor Cloud setup

Example model: **`cohere.embed-v4:0`** (1536-dim). Global inference ID: **`global.cohere.embed-v4:0`** via `embedModel` in config.

Authentication is either:

1. **Bedrock API key** (prefix `ABSK…`) in `apiKey` — bearer token, **not** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or
2. **IAM** via the AWS SDK default chain (no `apiKey` in config).

**Canonical config file** — `~/.config/sensegrep/config.json`:

```json
{
  "provider": "bedrock",
  "embedModel": "cohere.embed-v4:0",
  "embedDim": 1536,
  "region": "us-east-1",
  "apiKey": "<Bedrock API key from console>"
}
```

`embedDim` must be **256, 512, 1024, or 1536** for Cohere Embed v4.

**Cursor Cloud secret (preferred):** one secret named **`SENSEGREP_EMBEDDINGS_CONFIG`** whose value is the **entire JSON above** (minified one line is fine). The VM **update script** writes it to `~/.config/sensegrep/config.json` on startup. Do **not** use separate `GEMINI_API_KEY` or `AWS_ACCESS_KEY_ID` secrets for this setup.

**Optional env overrides** (merge with / override file): `SENSEGREP_PROVIDER`, `SENSEGREP_EMBED_MODEL`, `SENSEGREP_EMBED_DIM`, `SENSEGREP_BEDROCK_REGION`.

**VS Code / Cursor extension:** `sensegrep.embeddings.provider` = `bedrock`; for API-key auth, mirror the same fields in global `config.json` (extension does not store Bedrock keys in SecretStorage today).

When provider use and source transmission are authorized, this smoke flow writes an index and may incur provider cost (after build, with `config.json` in place):

```bash
node packages/cli/dist/main.js index --root packages/core --no-watch
node packages/cli/dist/main.js search "embedding configuration" --limit 3 --json
```

### Other providers

- **Gemini:** `GEMINI_API_KEY` / `GOOGLE_API_KEY` (selected automatically when a Gemini key is present and no provider or OpenAI-compatible key is set)
- **OpenAI-compatible:** `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` with `--provider openai`

Without `apiKey` (and without IAM credentials), Bedrock fails with `CredentialsProviderError`. `languages`, `status`, and MCP **initialize / tools/list** still work without indexing.
