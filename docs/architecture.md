# Architecture

Sensegrep has four runtime surfaces: `@sensegrep/core`, the CLI, the stdio MCP server, and the VS Code extension. CLI, MCP, and VS Code depend on core; core does not import those adapters.

## Operation Context

Project roots, named index profiles, and temporary embedding overrides are operation-scoped through Node `AsyncLocalStorage`. Code running under `Instance.provide()` or `Embeddings.withConfig()` may overlap with another operation without observing its directory, profile, provider, model, or dimension. Do not replace these contexts with process-global mutation.

## Index Lifecycle

Index writes are serialized per canonical project root in-process and across processes. Disk locks contain a PID and ownership token; only the owner can release them.

A full index is built in a versioned LanceDB table. Sensegrep embeds and persists bounded windows, validates the final row count and vector dimension, then atomically updates `index-meta.json` to activate the staged table. Interrupted stages are fingerprinted and resumed by skipping persisted IDs; `resume: false` discards failed stages. Incremental file replacement snapshots prior rows, reuses vectors for content-identical chunks, and restores prior rows if append fails.

Indexes with at least `SENSEGREP_ANN_MIN_CHUNKS` rows (10,000 by default) receive a vector ANN index plus scalar indexes for common file/symbol filters. Named profiles use independent directories and metadata for side-by-side provider/model experiments.

Metadata is schema-validated and written using a temporary file plus rename. Project directories use a strong hash while retaining read compatibility with legacy directory names.

## Cancellation

CLI time budgets and MCP/VS Code cancellation propagate as `AbortSignal` through scans, query embeddings, hosted HTTP calls, Ollama, and Bedrock. LanceDB writes are awaited to completion before the project lock is released because its JavaScript API does not expose abortable writes.

## Credentials

The CLI and MCP can read credentials from environment variables or `~/.config/sensegrep/config.json`. VS Code stores provider keys in `SecretStorage`; workspace settings contain only non-secret provider/model/dimension/endpoint fields.

## Contracts

Tool inputs are validated before execution. Search, context, survey, cluster, indexing, graph, and duplicate inputs have runtime Zod schemas reused by MCP. New parameters should be added to one canonical schema and covered by invalid-input tests.

## Source integrity and execution status

`SourceReader` validates bounded UTF-8 reads, regular-file identity, root confinement and actual line ranges. It rejects symbolic links in the supplied path, verifies opened-file identity and, on Linux, checks the opened descriptor's path. These checks are defense in depth, not a filesystem isolation boundary against a privileged concurrent writer. Search reconstruction also checks indexed source hashes; stale or unreadable reconstructions cannot authorize complete evidence.

Extended result IDs can carry the source-span hash. Legacy IDs remain readable but do not claim source freshness. `context` preserves prerequisite/error states from search. Index freshness is independently `fresh`, `stale` or `unknown`; timeout is unknown, not fresh. Audit coverage explicitly means file representation, not complete changed-hunk review, and unreadable files remain uncovered.

## Selection and diagnostics

`packet-selection.ts` implements source-set admission without treating intersecting line ranges as full coverage. Every accepted package keeps its complete required source set within physical-source, per-file, per-symbol and estimated-token limits. `stage-diagnostics.ts` aggregates phase outcomes without losing failures. Vector and lexical ranks/scores remain distinct from the fused score and are exposed in diagnostic traces.

## Watchers and resource bounds

A watcher has an explicit canonical root and profile identity. Generation-based refresh queues coalesce events; failed refreshes remain pending, and events arriving during an update are not acknowledged by that update. Stop cancels and awaits the active refresh before releasing its lock. Ignore-policy changes invalidate filters and schedule reconciliation.

Embedding quotas use bounded, cancellable per-identity FIFO queues. Impossible batches fail promptly. Duplicate detection chooses its additional distance/vector cache against `SENSEGREP_DUPLICATE_MEMORY_MIB` (128 MiB by default); this does not account for source data already loaded. Similarity is not a proof of behavioral equivalence.

Atomic index generation copying remains in place. Mutation logs now expose copy and mutation durations; no unvalidated copy-on-write replacement has been introduced.

## Network consent

Jev requires explicit mode selection, not merely a credential. `SENSEGREP_NETWORK_POLICY=local-only` blocks hosted inference and remote automatic downloads from the guarded core paths; loopback model endpoints remain usable. The experimental HTTP MCP adapter remains local, query-only and unsuitable as a hosted multi-tenant service without a separate authorization layer.
