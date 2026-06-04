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

### Semantic index and search (requires API keys)

Indexing and semantic search use **remote embeddings only** (default provider: Gemini). CI does **not** set embedding keys.

Before `sensegrep index` or semantic `search` / `survey` / `cluster`:

- Set **`GEMINI_API_KEY`** or **`GOOGLE_API_KEY`**, or
- Use **`--provider openai`** with **`SENSEGREP_OPENAI_API_KEY`** / **`FIREWORKS_API_KEY`**, or
- Use **`--provider bedrock`** with AWS credentials.

Example smoke flow (from repo root, after build):

```bash
export GEMINI_API_KEY=...
node packages/cli/dist/main.js index --root . --no-watch
node packages/cli/dist/main.js search "embedding configuration" --limit 3 --json
```

Without keys, `index` fails fast with a clear configuration error; `languages`, `status`, and MCP **initialize / tools/list** still work.

### MCP server

The MCP server speaks **stdio JSON-RPC**. It starts file watching by default; use a short `timeout` in scripted tests. Tools include `sensegrep_search`, `sensegrep_index`, `sensegrep_survey`, `sensegrep_cluster`, and `sensegrep_detect_duplicates`.

### Optional: ripgrep

`rg` on `PATH` is optional; core can download a ripgrep binary when missing.

### Gotchas

- **`npm run check` always rebuilds** via `precheck` → `npm run build`. If you change core, rebuild before exercising cli/mcp dist copies.
- **VS Code extension** (`packages/vscode`) is not fully covered by root `npm test`; extension dev uses `npm run dev --workspace sensegrep`.
- **No `.nvmrc`** — use Node 18+ (CI tests 18, 20, 22).
