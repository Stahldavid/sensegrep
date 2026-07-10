# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

sensegrep is an **npm workspaces monorepo** (TypeScript, Node >=20). There are **no Docker services or long-running HTTP servers**. Development centers on building packages and running Node CLIs:

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

#### Recommended: Cohere via Amazon Bedrock (Bedrock API key)

Default model: **`cohere.embed-v4:0`** (1536-dim). Global inference ID: **`global.cohere.embed-v4:0`** via `embedModel` in config.

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

Example smoke flow (after build, with `config.json` in place):

```bash
node packages/cli/dist/main.js index --root packages/core --no-watch
node packages/cli/dist/main.js search "embedding configuration" --limit 3 --json
```

#### Other providers (optional)

- **Gemini:** `GEMINI_API_KEY` / `GOOGLE_API_KEY` (default provider if unset and no OpenAI key)
- **OpenAI-compatible:** `SENSEGREP_OPENAI_API_KEY` / `FIREWORKS_API_KEY` with `--provider openai`

Without `apiKey` (and without IAM credentials), Bedrock fails with `CredentialsProviderError`. `languages`, `status`, and MCP **initialize / tools/list** still work without indexing.

### MCP server

The MCP server speaks **stdio JSON-RPC**. It starts file watching by default; use a short `timeout` in scripted tests. Tools include `sensegrep_search`, `sensegrep_index`, `sensegrep_survey`, `sensegrep_cluster`, and `sensegrep_detect_duplicates`.

### Optional: ripgrep

`rg` on `PATH` is optional; core can download a ripgrep binary when missing.

### Gotchas

- **`npm run check` always rebuilds** via `precheck` → `npm run build`. If you change core, rebuild before exercising cli/mcp dist copies.
- **VS Code extension** (`packages/vscode`) is not fully covered by root `npm test`; extension dev uses `npm run dev --workspace sensegrep`.
- **No `.nvmrc`** - use Node 20+ (CI tests 20, 22, 24).
