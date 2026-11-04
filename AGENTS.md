# sensegrep repository guidance

## Scope and context

This TypeScript npm-workspaces repository contains the core engine, CLI, MCP server and editor extension. Use the selected checkout's manifests and lockfile for runtime versions; `.nvmrc` recommends Node 24. The separate Remotion `demo/` is relevant only to video work. No Docker service is required for ordinary development.

Read the files relevant to the task rather than loading all architecture/setup documentation. Use [CONTRIBUTING.md](CONTRIBUTING.md) for delivery conventions and [.github/CI_LOCAL.md](.github/CI_LOCAL.md) for validation profiles. Preserve existing edits and continue within the current task's authorization. Historical setup observations do not grant new effects.

## Validation by change

- Prose-only work: inspect the diff and check affected links/command claims; do not build, install, index or call providers merely to validate wording.
- Runtime changes: build once when its inputs changed, then use `check:types`/`check:ci` and `test:unit`/`test:ci` as appropriate. `check` and `test` run build prehooks, so avoid chaining them after a current build without need.
- Contracts crossing runtimes: include relevant `test:node`, `test:python`, artifact/version or extension checks. Root Vitest does not cover every extension/runtime surface.
- `ci:local` is the comprehensive local chain, not a passive inspection. Complete required CI/release gates for that delivery; expand earlier testing when failures or unresolved concerns justify it.

`npm run build` replaces dist artifacts and uses a build lock. Root `dev` is a placeholder; extension development uses its workspace script. Tests do not need API keys. Do not change the CI matrix or security gates as a side effect of simplifying instructions.

## Retrieval and privacy

Use [the CLI skill](skills/sensegrep-cli/SKILL.md) when semantic/structural discovery helps; direct text searches remain appropriate for exact names and exhaustive occurrences. Keep detailed examples in references.

Indexing writes state and can call an embedding provider. MCP normally uses stdio and can start watching; daemon and loopback HTTP are separate optional runtimes. Do not install/index/start these merely to read source. For local-only requests, inspect resolved provider settings and use `SENSEGREP_NETWORK_POLICY=local-only`; Jev evaluation and embeddings are distinct effects. Preserve explicit consent before remote source transmission or paid calls, including benchmarks. See [Jev](docs/jev.md).

Host-specific Bedrock/Cursor configuration belongs in [agent setup](docs/agent-skills.md), not this always-loaded file. A past provider configuration is not current availability or a universal quality recommendation.
