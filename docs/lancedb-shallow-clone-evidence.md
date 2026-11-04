# LanceDB shallow-clone evidence

Experiment date: 2026-11-04. Executor: Linux/WSL, Node 24.16.0. Dependency: the repository-installed `@lancedb/lancedb` 0.23.0, imported from its local `dist/index.js`. No package installation, embedding provider, network request, existing index or personal XDG state was used. Every database was under a fresh `/tmp/sensegrep-clone-*` directory and was removed after the experiment.

The installed `Connection.cloneTable(target, sourceUri, { sourceVersion, isShallow })` documentation describes independent manifests sharing source data, deletion and index files. The executable behavior matters for cleanup: sharing does **not** make the target self-contained or protect source files automatically.

## Observed behavior

| Experiment | Result |
|---|---|
| Shallow clone of source version 1 | Target initially contains a manifest and transaction file, with no `data/` file. The source's 826-byte data fragment remains the sole data fragment for the two-row fixture. |
| Delete one row and add another in clone | Source still returns IDs 1 and 2; clone returns IDs 2 and 3. Private changes are isolated. |
| Explicit source version, different database directory | Source at version 2 returns IDs 1 and 2; clone explicitly based on version 1 returns only ID 1. |
| Drop the source table | The clone's next scan fails with a missing source data-file error. |
| Modify source, then `source.optimize({ cleanupOlderThan: new Date(Date.now()+1000), deleteUnverified: true })` | Pruning removes two old versions and data needed by the clone; the clone fails with a missing source data-file error. |
| Tag source version before the same source pruning | Optimization fails with a tagged-version cleanup error; the clone remains readable. Tags do not make source `dropTable` safe. |
| `isShallow: false` | Rejected: deep clone is not implemented in this installed version. |
| Modify clone, then optimize clone | In this two-fragment fixture compaction rewrites into a target-local data fragment. Source remains readable, and this particular clone survives source deletion. |
| Optimize an unchanged one-fragment clone | Compaction rewrites nothing. Source deletion still breaks the clone. `optimize()` success does not prove detachment. |

These are tiny deterministic correctness fixtures, not a throughput, RSS, ANN quality or disk-efficiency benchmark for a production corpus.

## Consequences for Sensegrep

Native shallow cloning is a useful copy-on-write primitive for local independent views. It can replace a full Arrow-row copy, while allowing ordinary LanceDB queries to rank over the selected view without custom multi-segment top-k merging. It requires an explicit retention protocol:

1. Publish a dependency on the exact source generation/version before making the clone visible, under coordination shared with the collector.
2. Treat data-bearing base generations as immutable. Do not prune versions or delete tables that remain reachable from a visible/pinned view.
3. Preserve the transitive dependency closure: a clone of a clone may still reference an older ancestor's data.
4. Collect a table only when no active view, reader, retained snapshot or descendant depends on it. Crashed or partially published state must conservatively retain data until safely reconciled.
5. Bound history by retaining a configured number of unreferenced generations and by deliberate materialization/compaction when ancestry grows. Do not declare a view independent merely because `optimize()` completed.
6. Keep immutable source-file retention and embedding reuse as separate mechanisms. A shallow-cloned vector table alone does not capture source bytes or authorize sharing private worktree changes.

Clones reference source paths. Moving or copying only the clone directory is not a portable snapshot protocol. The dependency graph and its files must be transferred or materialized deliberately before relocation. No experiment here validates shared mutable databases over a network filesystem or separate physical machines.

The two probe scripts and raw reports were retained locally as temporary evidence at `/tmp/sensegrep-clone-probe.mjs`, `/tmp/sensegrep-clone-probe-report.json`, `/tmp/sensegrep-clone-probe-extra.mjs` and `/tmp/sensegrep-clone-probe-extra-report.json`. These temporary paths are not durable repository fixtures. Runtime code was not changed by this investigation.

## Managed coordination implementation

`packages/core/src/semantic/clone-dependencies.ts` provides one local guard at `Global.Path.data/clone-coordination-v1/guard` and an atomically published dependency registry. Callers must hold `withCloneGuard` while recording a source-to-target edge, invoking native clone, publishing/deleting tables and releasing dependencies. The edge must be durable before native clone starts; failure between the edge and publication retains a conservative pin. Table deletion requires checking `findCloneDependents` first, and dependency removal happens only after successful target deletion. `cloneDependencyDepth` supports a caller-defined checkpoint limit; this module does not materialize or prune tables itself.

Registry operations reject cycles and duplicate target parents. A missing registry after initialization or malformed state fails closed. Registry addresses use real database directories, preserving Linux case and normalizing Windows case. The guard is shared among cooperating processes using the same state location; old binaries and direct LanceDB mutation do not participate. If a holder dies, the guard remains for explicit recovery after verifying all participants have stopped. The registry must be preserved, not deleted as part of guard recovery.

Five focused tests passed with all XDG directories isolated: transitive pin lifecycle and cycles; missing/corrupt registry and initialization crash window; cancellation and abandoned guard; native shallow-clone isolation with guarded source deletion; and serialization of two real processes plus abrupt guard-holder exit. The native test intentionally uses source-version pinning. These tests establish cooperating local-process behavior, not full application integration, network-filesystem semantics or Windows execution.
