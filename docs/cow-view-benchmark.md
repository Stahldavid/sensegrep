# Copy-on-write view benchmark

Run from the repository root:

```sh
node scripts/benchmark-cow-views.mjs 3 10 2000 32
```

The arguments select concurrent clients (1–8), samples per client/scenario (2–100), document count (100–20,000), and dimensions (8–128). The script bundles the **current TypeScript implementation** of `VectorStore.forkCollection` into a temporary worker; it does not use stale `dist` or the installed CLI. It runs copy and copy-on-write modes in separate child processes, each with fresh XDG config, cache, data and state directories. The script makes no provider calls, uses no remote machine, removes its temporary data and worker, and does not optimize/prune a base with dependents.

The final run includes the source-generation lease acquired inside `forkCollection`, the shared native session, and the current release/admission-budget implementation. Each mode creates one source checkout and three independent target roots, explicitly bound to the same repository UUID. They are independent temporary directories, not actual Git worktrees. The fixed source contains 2,000 deterministic function documents with 32-dimensional SHA-256-derived vectors and a real LanceDB table. `SENSEGREP_SHARED_OBJECTS=0` uses the integrated full-copy path; `=1` uses the integrated native COW path. The benchmark fixes the native shared session budgets at 256 MiB of index cache and 64 MiB of metadata cache, with a COW depth limit of eight, and records `VectorStore.getResourceUsage()` in the raw report. Thirty views are created and deleted per scenario, including concurrent guard contention. Each target view is removed before the next sample; this measures repeated bounded view lifetimes rather than keeping 30 views resident at once.

The unchanged scenario only forks. The small-change scenario replaces one source file with a private changed document and vector. Assertions verify the `shared` result, row counts, original and changed document contents, vector coordinates, a filtered exact cosine search, source immutability, absence of copied target data fragments on an unchanged COW fork, and complete target-table cleanup. This is correctness evidence for the exercised native path, not a test of approximate ANN recall. No ANN index is built.

## Observed results

Observed on 2026-11-04: Node v24.16.0, Linux WSL2 6.18.33.2, AMD Ryzen 9 8940HX, 32 logical CPUs, 16,349,106,176 bytes reported RAM. Each source table occupied 716,419 bytes in regular files, of which 709,299 were data fragments. These figures sum file lengths, not allocated disk blocks or memory-mapped residency. Full machine-readable results are in [the report](evaluations/cow-views-2026-11-04/report.json).

| Scenario | Full-copy p50 / p95 | COW p50 / p95 | Timing scope |
|---|---:|---:|---|
| Unchanged view | 181.517 / 255.696 ms | 34.881 / 61.428 ms | Fork |
| One-file replacement | 221.930 / 259.223 ms | 69.514 / 104.994 ms | Fork plus replacement |

Fork/replacement timing excludes explicit validation queries, byte enumeration and deletion. Those operations can overlap other concurrent clients, so this measures the selected operations under this local concurrent workload rather than an isolated native-call cost or complete indexing wall time.

| Per-view storage, median | Full copy | COW |
|---|---:|---:|
| Own regular-file bytes, unchanged | 724,661 | 2,009 |
| Own data-fragment bytes, unchanged | 715,668 | 0 |
| Own regular-file bytes, one-file replacement | 736,748 | 14,192 |
| Own data-fragment bytes, one-file replacement | 722,901 | 7,233 |

COW views reference the retained 709,299-byte source data instead of duplicating it initially. The source still occupies storage and cannot be pruned/deleted while referenced. The COW figures are additional bytes for a view; they do not mean the complete repository is stored in 2 KB. Small changes create private data and deletion/manifest metadata. A full-copy target's representation differs slightly from the source, so exact byte ratios should not be generalized to arbitrary corpora.

Peak observed process RSS was **545,017,856 bytes** for copy mode and **397,869,056 bytes** for COW mode. Each mode had its own process, with the unchanged scenario followed by the changed scenario and a shared source handle. The benchmark closes target handles after each operation, but native allocators and garbage collection can retain memory. These are process high-water marks across the complete run, not steady-state memory per agent, measured daemon savings, an enforced total-process memory budget, or the size of one table. The session budgets apply to native caches rather than all process allocations. The end-of-run native cache sizes reported before deleting the source were 4,232,800 bytes for copy and 43,608 bytes for COW; these snapshots are not cache peaks.

## Scope of the conclusion

This workload demonstrates lower added storage and lower fork latency using the integrated COW implementation, while preserving the tested private changes and query results. It justifies replacing unconditional row copies for eligible local forks. It does not measure parser reuse, embedding cache misses, actual provider costs, branch discovery, large ANN indices, long ancestry, checkpoint cost, long-running reader retention, real Git worktrees, or two physical machines. The earlier clone probe's dependency-retention requirements remain essential; see [LanceDB clone evidence](lancedb-shallow-clone-evidence.md). A bounded-depth checkpoint may intentionally materialize a full table, and its cost is not represented by these depth-one forks.
