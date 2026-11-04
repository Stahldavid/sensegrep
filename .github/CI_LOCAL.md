# Local CI preparation

Run `npm run ci:local` after `npm ci`. It builds once, checks all workspaces, checks version consistency, and runs unit tests with two workers. `check:ci` suppresses npm lifecycle hooks only after the explicit build; `test:ci` invokes the same Vitest suite without pretest. Run those individual CI commands only after building.

This is a focused development preflight. Dependency acceptance also requires `npm audit`, which queries the npm registry, and the supported-platform checks. The audit remains mandatory in the prepared workflow; it is not silently treated as passed by ci:local.

The existing `npm run check` and `npm test` retain their automatic rebuilds for standalone development. The prepared workflow retains nine OS/Node combinations (Node 20, 22 and 24 on Linux, Windows and macOS), dependency audit, checks and tests. It adds cancellation, read-only permissions and a 30-minute job timeout. No workflow was dispatched.

The existing local native Node and Python tests, packaged-artifact verification and README link checks are also preserved in ci:local. The existing workflow already uses check:types/test:unit without duplicate lifecycle builds; those commands and all additional local workflow checks are retained.

Security updates move Changesets to 3 and VSCE to 4. Their supported development runtimes require Node 22.12, 24 or 26 and later; Node 20 is no longer a full development-toolchain target. Published runtime package engine declarations remain unchanged. Changesets configuration uses the v4 schema; this repository does not use removed tag/sinceMaster/prettier options.

The three Node 20 lanes install and build with Node 24, then switch to Node 20 to import the published core/MCP entrypoints and invoke the built CLI. Node 22/24 lanes retain the full profile. No development tooling runs on Node 20. Runtime smoke checks require no API credentials or external services.
