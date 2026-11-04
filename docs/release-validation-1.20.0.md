# Release validation: 1.20.0

Date: 2026-11-04. Executor: Ubuntu WSL, Linux x64, Node 24.16.0. Checkout: the selected native Linux repository on `works/integrity-evidence-contracts`. The accumulated candidate was preserved in commit `6444ddd`; merge `6986092` incorporated upstream 1.19.1, including dependency security patches and the full nine-lane CI matrix. Personal state and private Jev evaluation corpora are excluded from the release.

The release bumps `@sensegrep/core`, `@sensegrep/cli` and `@sensegrep/mcp` to 1.20.0. Plugin manifests and MCP runtime versions are synchronized; the editor extension retains its independent version. See [the architecture](parallel-agent-architecture.md), [shared views](shared-worktree-indexes.md), [legacy cleanup](legacy-cleanup.md) and [local model installation](local-embeddings.md).

## Local checks

After installing the locked dependencies, build once with `npm run build`. Validation used task-specific, empty config/cache/data/state XDG directories and a socket guard denying non-loopback connections for runtime tests. The extension test used the isolated configuration and the local VS Code extension host. All provider behavior in automated engine tests was deterministic or mocked; no paid inference was called.

| Check | Result |
| --- | --- |
| `npm run check:types` | All workspaces passed |
| `npm run version:check` | 1.20.0 consistent |
| `npm run test:unit -- --maxWorkers=2` | 530 tests, 83 files passed |
| `npm run test:node` | 70 tests passed |
| `npm run test:python` | 26 tests passed |
| `npm test --workspace sensegrep` | Local extension host passed, exit 0 |
| `npm run release:verify` | All three npm package layouts passed |
| `npm run check:docs` and affected-document links | No missing local links |
| `npm audit` | Zero vulnerabilities |
| `node scripts/smoke-shared-worktrees.mjs` | Built-artifact scenario passed |

The worktree smoke created two real Git worktrees and launched two built CLI processes concurrently. It observed one deterministic loopback embedding request for four inputs, separate view manifests, shared source inodes, a retained base while a dependent view remained active, and zero retained tables after both views were released and collected. It did not call Ollama or an external provider.

## Packed artifacts

Actual tarballs were produced using `npm pack --workspace @sensegrep/core --workspace @sensegrep/cli --workspace @sensegrep/mcp --pack-destination <temporary-directory>`. Installing those tarballs into a fresh consumer directory with `npm install --ignore-scripts --omit=dev` succeeded. The same worktree smoke passed against the installed core and CLI paths, and the installed MCP module imported successfully. Package file lists contain no private evaluation corpora, tokenizer JSON, model weights or extension-test downloads.

## Limits

These checks validate Linux/WSL locally. The hosted CI matrix retains Node 20/22/24 on Linux, Windows and macOS; its result is separate from this record. Two local executors or processes do not prove operation between two physical machines. Remote ANN artifact distribution remains outside the implemented source-object protocol. Local model cold inference is a single installation check, not a performance benchmark or evidence of semantic retrieval quality. npm publication must be confirmed separately against the registry after the publishing workflow completes.
