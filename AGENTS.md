# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

sensegrep is an **npm workspaces monorepo** (TypeScript, Node ≥18). There are **no Docker services or long-running HTTP servers**. Development centers on building packages and running Node CLIs:

| Package | Role | After `npm run build` |
|---------|------|------------------------|
| `packages/core` | Search engine (`@sensegrep/core`) | `packages/core/dist/` |
| `packages/cli` | CLI (`sensegrep`) | `node packages/cli/dist/main.js` |
| `packages/mcp` | stdio MCP server | `node packages/mcp/dist/server.js` |
| `packages/vscode` | VS Code/Cursor extension | `npm run dev --workspace sensegrep` (esbuild watch) |

The `demo/` folder is a **separate** Remotion project (not in workspaces); only needed for marketing video scripts.

### Standard commands (see also `CONTRIBUTING.md`)

- Install: `npm ci` (CI uses lockfile; `npm install` also works)
- Build: `npm run build` (`node build.js` — core → cli → mcp)
- Typecheck: `npm run check` (runs `precheck` → build, then workspace `tsc`)
- Tests: `npm test` (Vitest; **no API keys required**)
- Version consistency: `npm run version:check`

Root `npm run dev` is a **placeholder**; use package-specific commands above.

### Lint / format

There is **no ESLint/Prettier** at the repo root. “Lint” for this repo means **`npm run check`** (TypeScript `--noEmit` per workspace).

### Semantic index and search (remote embeddings)

Indexing and semantic search use **remote embeddings only**. CI does **not** configure providers.

#### Recommended: Cohere via Amazon Bedrock

Default Bedrock model in code: **`cohere.embed-v4:0`** (1536-dim). Cross-region / global inference ID: **`global.cohere.embed-v4:0`** (set via `SENSEGREP_EMBED_MODEL`).

**Environment (CLI, MCP, extension):**

```bash
export SENSEGREP_PROVIDER=bedrock
export AWS_REGION=us-east-1          # or SENSEGREP_BEDROCK_REGION
# Optional overrides:
# export SENSEGREP_EMBED_MODEL=cohere.embed-v4:0
# export SENSEGREP_EMBED_DIM=1536      # must be 256, 512, 1024, or 1536 for Cohere v4
```

**AWS credentials:** standard AWS SDK chain (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, or instance/profile). No Gemini key is used when `SENSEGREP_PROVIDER=bedrock`.

**Persistent config** (`~/.config/sensegrep/config.json`):

```json
{
  "provider": "bedrock",
  "embedModel": "cohere.embed-v4:0",
  "embedDim": 1536,
  "region": "us-east-1"
}
```

**CLI flags** (override env for one run): `--provider bedrock` plus optional `--embed-model` / `--embed-dim`.

**VS Code / Cursor:** `sensegrep.embeddings.provider` = `bedrock`, region via `sensegrep.embeddings.bedrockRegion` (see `packages/vscode/README.md`).

**IAM:** caller needs `bedrock:InvokeModel` on the chosen Cohere embedding model in that region (model access enabled in the Bedrock console).

Example smoke flow (from repo root, after build):

```bash
export SENSEGREP_PROVIDER=bedrock
export AWS_REGION=us-east-1
node packages/cli/dist/main.js index --root packages/core --no-watch
node packages/cli/dist/main.js search "embedding configuration" --limit 3 --json
```

#### Other providers (optional)

- **Gemini:** `GEMINI_API_KEY` / `GOOGLE_API_KEY` (default provider if unset and no OpenAI key)
- **OpenAI-compatible:** `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` with `--provider openai`

Without credentials, Bedrock fails with `CredentialsProviderError`; Gemini/OpenAI fail with explicit API-key errors. `languages`, `status`, and MCP **initialize / tools/list** still work without indexing.

### MCP server

The MCP server speaks **stdio JSON-RPC**. It starts file watching by default; use a short `timeout` in scripted tests. Tools include `sensegrep_search`, `sensegrep_index`, `sensegrep_survey`, `sensegrep_cluster`, and `sensegrep_detect_duplicates`.

### Optional: ripgrep

`rg` on `PATH` is optional; core can download a ripgrep binary when missing.

### Gotchas

- **`npm run check` always rebuilds** via `precheck` → `npm run build`. If you change core, rebuild before exercising cli/mcp dist copies.
- **VS Code extension** (`packages/vscode`) is not fully covered by root `npm test`; extension dev uses `npm run dev --workspace sensegrep`.
- **No `.nvmrc`** — use Node 18+ (CI tests 18, 20, 22).
