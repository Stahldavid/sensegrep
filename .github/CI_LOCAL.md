# Local CI checks

Use Node 22.12 or later (Node 24 recommended) to install the development tools with `npm ci`. Run `npm run ci:local` to build once, typecheck every workspace, check package versions, run the unchanged Vitest suite with two workers, run native Node and Python contracts, verify packaged artifacts and check README links. Run `npm audit` separately; it queries the registry and remains mandatory in hosted CI.

The hosted matrix retains all nine OS/Node combinations, including `npm ci`, audit, build, typechecking, version checks, Vitest, native contracts and artifact verification on Node 20. Changesets 3 and VSCE 4 declare newer Node requirements, so npm may report engine warnings in Node 20; their release commands use Node 24 in the existing manual release workflows. No engine-strict bypass or support reduction is configured. Native Python research tests run once on Linux/Node 24. Standalone `npm test` and `npm run check` keep their automatic builds.

The proposed Node 20 runtime-only smoke profile is not enabled. It would remove Node 20 build, typecheck, version, Vitest and native-contract coverage. Adopting it requires an explicit support and coverage decision. The existing human proposal is preserved in the task evidence snapshot.

This isolated CI change includes build-lock and evaluator contracts that run independently of uncommitted product changes. The original core-runtime contract suite depends on new source modules and is preserved in the task snapshot for separate product review. It is not silently imported into this CI branch.

Concurrency cancellation, read-only workflow permissions and a 30-minute job timeout bound CI work. No publishing/deployment command is part of this workflow.

Build-lock reclamation uses an exclusive guard. A process crash while holding that guard fails closed and may require removing the abandoned `.sensegrep-build.lock.reclaim` after confirming no build is active. Active owners are never evicted by age.
