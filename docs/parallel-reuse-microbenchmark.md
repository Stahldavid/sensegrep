# Local vector reuse microbenchmark

Run `npm run build` after changing core inputs, then `node scripts/benchmark-local-reuse.mjs 2 20`. The script imports `packages/core/dist/index.js`; it does not measure unbuilt source or the globally installed CLI. It creates temporary isolated XDG directories and deletes them afterwards. It uses no provider or network. Arguments are the number of concurrent clients (1–8) and the number of samples per client (2–1000).

The fixed synthetic corpus has 100 one-line files per independent temporary root, with an 8-dimensional SHA-256-derived deterministic vector. Each root has its own real LanceDB table. The benchmark compares calculating all 100 synthetic vectors in memory against the current `VectorStore.reuseDocumentVectors` read plus calculation of the pending inputs. It validates every returned vector and counts pending and reused inputs. These are **simulated embedding inputs**, not network requests. The baseline does not include a LanceDB read, indexing, parsing, locks or staging copies; consequently the timings describe this particular microbenchmark, not end-to-end speedup or provider latency. The roots model independent local checkouts; they are not Git worktrees or separate physical machines.

Observed on 2026-11-04, Node 24.16.0, Linux WSL2 6.18.33.2, AMD Ryzen 9 8940HX, 32 logical CPUs and 16,349,106,176 bytes reported RAM, two clients, 20 samples each (40 operations per scenario):

| Scenario | Synthetic baseline p50 / p95 | Existing reuse p50 / p95 | Calculated inputs: baseline → reuse | Reused inputs |
|---|---:|---:|---:|---:|
| unchanged | 0.230 / 0.525 ms | 12.925 / 16.893 ms | 4,000 → 0 | 4,000 |
| one changed document | 0.154 / 0.389 ms | 12.299 / 14.696 ms | 4,000 → 40 | 3,960 |

Peak process RSS was 224,718,848 bytes; the isolated data directory occupied 86,296 bytes after setup. The script did not copy a collection or acquire an indexing lock, so copied bytes and lock wait are not measured. No new caching strategy is evaluated here. The synthetic calculation is deliberately not a proxy for an actual model: these measurements show reduced simulated inputs but do not establish a latency or cost benefit for a real provider. They do not justify a base-plus-overlay design or cross-project deduplication. End-to-end indexing, lock contention, real Git worktrees and a controlled before/after cache measurement remain necessary before deciding that optimization.
