# sensegrep repository guidance

## Scope and runtime

sensegrep is a TypeScript npm-workspaces monorepo: core search engine, CLI, MCP server and VS Code/Cursor extension. Root/core/CLI/MCP manifests in this checkout declare Node >=20; `.nvmrc` recommends Node 24. CI retains Node 20/22/24 across Linux, Windows and macOS. Changesets 3 and VSCE 4 require Node 22.12+ for release tooling. Use the selected checkout's manifests; other working/checkpoint variants have different development ranges.

No Docker service is required. MCP normally uses stdio; experimental loopback HTTP and the local daemon are optional runtimes. The separate Remotion `demo/` is outside workspaces and needed only for video tasks.

## Commands and effects

- Install only within the authorized task: `npm ci` uses the lockfile.
- `npm run build` runs `node build.js` (core → CLI → MCP → VS Code), replacing dist artifacts and using a build lock.
- `npm run check` invokes precheck/build before workspace TypeScript checks; `npm test` invokes pretest/build before Vitest. Tests require no API keys.
- After an appropriate build, `check:types`/`check:ci` and `test:unit`/`test:ci` omit those specific prehooks. `test:node` and `test:python` cover separate native runtimes; names alone do not guarantee no writes.
- `version:check` checks version consistency. `ci:local` chains build, types, versions, Vitest, Node, artifact, docs and Python checks; it is not inspection-only.
- Root `dev` is a placeholder. Extension development uses `npm run dev --workspace sensegrep` (esbuild watch); root Vitest does not fully cover the extension. Contract changes need the relevant native runtime checks as well as Vitest.
- There is no root ESLint/Prettier. The repository's type check is `npm run check`, with its build effect. For prose, use diff/link/semantic checks instead of broad suites.

Read [CONTRIBUTING](CONTRIBUTING.md) for workflow details and [.github/CI_LOCAL.md](.github/CI_LOCAL.md) for validation profiles. Manifests and the runtime distinction above govern Node support.

## Retrieval and privacy

Follow [the CLI skill](skills/sensegrep-cli/SKILL.md) for semantic discovery versus literal proof, evidence limits and snapshot-bound continuation. Do not paste its manual into AGENTS.

For local-only tasks, verify the resolved embedding provider, model and endpoint; a saved Ollama setting can be overridden by environment/CLI settings. Explicitly disable Jev with `--jev off` on applicable commands. Embeddings and remote evidence evaluation are separate effects: dedicated Jev credentials can enable automatic search/context evaluation, which sends queries, paths/symbols and snippets to OpenRouter. Do not enable remote source transmission or paid provider calls without task consent, including when indexing or benchmarking. See [Jev](docs/jev.md), [embedding configuration](README.md#embeddings-configuration) and [chunking](docs/chunking.md).

Ordinary `selftest` checks configuration without embedding calls; `--deep` exercises the provider. Indexing writes index/cache/checkpoints and may call embeddings. Do not install, index, start MCP/daemon/watch, download models or change config merely to inspect source. MCP watches by default; optional ripgrep fallback can download a binary when rg is missing. Account for those effects before starting it.

Cursor Cloud Bedrock credentials, secret handling, overrides and extension limitations belong in [the host-specific setup](docs/agent-skills.md#cursor-cloud-embeddings). Select a provider by privacy, endpoint availability, cost, model/dimension compatibility and task evidence; do not assume a universal quality winner.
