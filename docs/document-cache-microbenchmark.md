# Document cache microbenchmark

Run from the repository root: `node scripts/benchmark-document-cache.mjs 2 20`. Arguments select 1–8 concurrent clients and 2–1,000 samples per client. The wrapper bundles the current TypeScript source into a temporary module, starts a child with isolated XDG config, cache, data and state directories, and deletes the temporary artifacts. The benchmark replaces `fetch` with an in-process deterministic provider; it makes no network requests. The provider returns eight-dimensional vectors derived from SHA-256, and every returned vector is checked against its expected value.

The corpus contains 100 fixed synthetic documents in one temporary checkout. Each of two concurrent clients performs 20 requests per scenario. The unchanged cached run starts with an empty cache; the small-change cached run follows it with one changed document. The uncached runs use the same corpus, adapter, validation and vector checks. Measurements are of the embedding call plus vector verification, including cache file operations; they are not full indexing measurements.

Observed on 2026-11-04 with Node 24.16.0, Linux WSL2 6.18.33.2, AMD Ryzen 9 8940HX, 32 logical CPUs and 16,349,106,176 bytes reported RAM:

| Scenario | Cache | p50 / p95 per operation | Simulated provider requests | Inputs sent |
|---|---|---:|---:|---:|
| Unchanged | off | 1.836 / 4.684 ms | 40 | 4,000 |
| Unchanged, first run cold | on | 30.678 / 36.029 ms | 1 | 100 |
| One document changed | off | 1.492 / 2.248 ms | 40 | 4,000 |
| One document changed, prior corpus cached | on | 29.813 / 33.206 ms | 1 | 1 |

Combined peak observed process RSS was 87,228,416 bytes. The uncached runs had wall times of 58.961 ms and 32.452 ms; cached runs took 1,315.137 ms and 1,210.564 ms. The cache reduced simulated inputs but was slower in this test: the mock provider has negligible compute/network cost and the cache serializes requests and reads many local files. These numbers do not predict actual provider latency, cost, memory per client, contention across separate machines, or storage/copy costs. The synthetic clients share one process and checkout; the separate multiprocess regression tests cover local coordination, not throughput. Do not infer a production speedup without a representative, authorized provider workload.
