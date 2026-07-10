# Architecture

Sensegrep has four runtime surfaces: `@sensegrep/core`, the CLI, the stdio MCP server, and the VS Code extension. CLI, MCP, and VS Code depend on core; core does not import those adapters.

## Operation Context

Project roots and temporary embedding overrides are operation-scoped through Node `AsyncLocalStorage`. Code running under `Instance.provide()` or `Embeddings.withConfig()` may overlap with another operation without observing its directory, provider, model, or dimension. Do not replace these contexts with process-global mutation.

## Index Lifecycle

Index writes are serialized per canonical project root in-process and across processes. Disk locks contain a PID and ownership token; only the owner can release them.

A full index is built in a versioned LanceDB table. Sensegrep embeds and persists bounded windows, validates the final row count and vector dimension, then atomically updates `index-meta.json` to activate the staged table. A failed stage is removed while the previous metadata and table remain active. Incremental file replacement snapshots prior rows and restores them if append fails.

Metadata is schema-validated and written using a temporary file plus rename. Project directories use a strong hash while retaining read compatibility with legacy directory names.

## Cancellation

CLI time budgets and MCP/VS Code cancellation propagate as `AbortSignal` through scans, query embeddings, hosted HTTP calls, Ollama, and Bedrock. LanceDB writes are awaited to completion before the project lock is released because its JavaScript API does not expose abortable writes.

## Credentials

The CLI and MCP can read credentials from environment variables or `~/.config/sensegrep/config.json`. VS Code stores provider keys in `SecretStorage`; workspace settings contain only non-secret provider/model/dimension/endpoint fields.

## Contracts

Tool inputs are validated before execution. MCP schemas for indexing and duplicate detection are generated from the same Zod schemas used at runtime. New parameters should be added to one canonical schema and covered by invalid-input tests.
