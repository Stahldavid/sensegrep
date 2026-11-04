# Shared physical indexes with independent worktree views

This implementation uses the installed LanceDB 0.23 native shallow clone instead of a separate overlay query engine. A shallow clone has an independent manifest and shares immutable data, deletion and index files with its source. LanceDB applies deletions and replacements before ranking within the selected table, so the existing semantic, graph, lexical and filter consumers continue to query one coherent view. Changes in another checkout never select that view implicitly.

## Enable an authorized repository scope

Sharing is opt-in and requires explicit repository UUID registration for every participating checkout. With the built candidate CLI (or a distribution containing these commands), use the same chosen UUID only for checkouts intended to share data:

```sh
sensegrep repository register REPOSITORY_UUID --root /path/to/worktree-a
sensegrep repository register REPOSITORY_UUID --root /path/to/worktree-b
export SENSEGREP_SHARED_OBJECTS=1
sensegrep index --root /path/to/worktree-a --no-watch
sensegrep index --root /path/to/worktree-b --no-watch
```

Indexing uses the configured embedding provider; run it only with the appropriate provider authorization. Registration itself does not index or call a provider. Unregistered checkouts or sharing disabled retain the private-copy behavior. Existing stored indexes are preserved; unknown legacy runtime identities are not accepted as cross-checkout seeds. `--full` explicitly rebuilds. The candidate CLI can also be invoked as `node packages/cli/dist/main.js` after `npm run build`.

For an initial incremental index, a cold-view guard serializes initialization within repository/profile. The first view publishes its generation; compatible subsequent views seed from it. Compatibility requires matching local runtime artifact identity, provider/model/dimensions, full recorded embedding configuration and chunking signature. Plugins or unresolvable runtime layouts disable cross-checkout seed reuse. A seed's files are checked against target content even when size and mtime match. No target metadata is published if bootstrap cannot read its source files. Established views index independently under their existing checkout locks.

Native shallow clones need their source data directories. A durable dependency graph, protected by a process-shared guard, records a dependency before creating a clone. Drop, cleanup and release cannot delete a referenced base. Pins are transitive. Corrupt or abandoned coordination state fails closed. Automatic native compaction/pruning is skipped for derived or referenced tables; external LanceDB tools and older binaries must not prune these directories. At `SENSEGREP_COW_MAX_DEPTH` (default 8, range 1–64), a full-copy checkpoint detaches the new generation. This bounds ancestry but intentionally adds a materialized table; it is not a promise of zero duplication after arbitrary compaction. Unsupported native clone operations report failure rather than silently weakening isolation.

## Retention and budgets

Inactive generations obey the existing age/quantity retention plus a maximum ordinary-generation count, `SENSEGREP_INDEX_MAX_GENERATIONS` (default 32). Reader leases and clone dependencies override deletion. `repository release --root PATH --profile NAME` removes a view's active metadata while retaining bases and active readers. It accepts the original path of a deleted checkout. `repository gc --root REGISTERED_CHECKOUT --profile NAME` retries collection of explicitly released views in that repository/profile. These operations remove index state only, not working files. A reader or dependent view may keep physical data alive until a later collection.

`SENSEGREP_SHARED_INDEX_MAX_BYTES` defaults to 2 GiB. Publication serializes accounting of repository-owned Lance storage, including profiles, retained bases and staging data without active metadata. Referenced data is never evicted to force admission. Exceeding capacity rejects publication and preserves the previous active view. Physical staging happens before admission, so concurrent staging, filesystem metadata and other storage categories can temporarily require additional space. Source objects have their separate [guarded source budget](shared-source-retention.md), and the opt-in [embedding cache](document-embedding-cache.md) retains a bounded number of entries per repository/profile. Pins and guards left by a killed process require verified administrative recovery.

A process uses one shared native Lance session: `SENSEGREP_INDEX_CACHE_MIB` defaults to 256 and `SENSEGREP_METADATA_CACHE_MIB` to 64, configured on first connection. Connection/table maps retain at most 16/64 handles. Status exposes process cache usage through `resources`. These are native cache capacities and handle limits, not a hard RSS limit: query buffers, vectors, parser memory, native allocators and OS page cache are additional. Shared services should be preferred when many agents would otherwise start separate processes.

## Across executors

Each executor owns its mutable views and local Lance state. Source protocol v2 transfers a validated manifest followed by only missing SHA-256 objects; already verified objects and objects received before an interruption are reused on retry. The destination stores each source once and small per-snapshot manifests, rather than embedded full copies. Legacy protocol v1 and embedded artifacts remain readable. Use a new private destination for the new replica format when importing; mixed legacy directories are not silently rewritten.

[Replica retention](replica-source-store.md) keeps eight unpinned snapshots by default and applies a 512 MiB source-object budget. `snapshot pin`, `unpin` and `gc` expose retention. Credentials remain local to each executor, and the transport uses authenticated loopback through an authorized encrypted tunnel. No account signup, always-on connection, distributed mutable database directory or central provider quota is required. Each host indexes its private source independently and shares compatible views locally; physical copies needed for independent offline execution remain local. Protocol v2 transfers source objects, not portable native Lance fragments or provider credentials.

## Evidence

The [COW benchmark](cow-view-benchmark.md) compares integrated full-copy and COW paths using real LanceDB, deterministic vectors, concurrent clients, byte accounting and per-process RSS. It records limits including no ANN recall measurement and no steady-state per-agent RSS claim. The real Git-worktree regression tests dirty/untracked states, deletion, rename, matching size/mtime with changed bytes, source protection, bounded-depth checkpoint and released-view collection with an active reader. Additional process tests cover guards, quota admission, cold initialization, replica import/collection and interrupted transfer resumption. Physical two-machine validation remains distinct from isolated local executors.
