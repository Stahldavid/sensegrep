# @sensegrep/core

## 1.14.0

### Minor Changes

- Unify agent-facing output around a compact schema v2 across the core, CLI, daemon, and MCP transports.

  - standardize minimal result cards on `id`, `file`, `lines`, `symbol`, `kind`, `rank`, and `relevance`
  - add compact, deterministic result IDs while preserving support for legacy IDs
  - enforce token and byte limits against the final serialized payload, retaining partial evidence when complete code does not fit
  - separate content, diagnostics, and internal full output while removing duplicated metadata and source code
  - make survey and cluster summaries directly expandable through representative IDs
  - expose shared MCP output schemas and avoid duplicating structured payloads in textual responses

## 1.13.0

### Minor Changes

- Accelerate repeated and hybrid searches with a persistent query-embedding cache, concurrent semantic and lexical retrieval, adaptive lexical skipping, batched lexical index reads, lazy Bedrock loading, and a lighter query-only daemon with opt-in watching.

## 1.12.0

### Minor Changes

- [`66c9b74`](https://github.com/Stahldavid/sensegrep/commit/66c9b7401d2303627d7e9abb082f5c70f4658c88) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Make agent output contracts strict, structured, and substantially faster.

  - enforce output byte budgets against complete serialized CLI and MCP payloads
  - return typed JSON errors with argument exit code 2
  - preserve retrieval, universe, index, budget, warning, and filter explanation metadata
  - default survey and cluster agent output to summary and propagate lexical fallback warnings
  - add lightweight filesystem literal and show entry points
  - persist graph snapshots for fast references and impact calls
  - support clustering against readable legacy schemas without optional metadata columns

## 1.11.0

### Minor Changes

- [`ab5bf2b`](https://github.com/Stahldavid/sensegrep/commit/ab5bf2b877f802df9cbc50ca8e4e17e20c64049c) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add agent-focused JSON projections and enforce physical output budgets.

  - add minimal, content, diagnostic, and full projections, with compact as a compatibility alias
  - minify JSON by default and add `--pretty` and `--diagnostic` opt-ins
  - remove duplicate metadata and source code from ordinary agent output
  - expose final rank scores, audit ranges, and explicit semantic and textual coverage
  - enforce `maxOutputBytes` against final serialized CLI and MCP payloads
  - reduce literal, references, and duplicate-detection schemas

## 1.10.2

### Patch Changes

- [`0bddb8f`](https://github.com/Stahldavid/sensegrep/commit/0bddb8fe33f5f708689051b0f6242bb629001350) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Make agent output limits and structured schemas precise.

  - split large changed files into stable ranges so every audit batch strictly respects `batchTokens`
  - separate attempted evidence size from the bytes and tokens actually emitted by the CLI
  - use canonical search-result fields consistently across compact, content, CLI, and MCP output
  - add standard command envelopes to duplicate detection results
  - derive snippet integrity from persisted AST symbol regions without adding parsing to normal searches

## 1.10.1

### Patch Changes

- [`6abb2b1`](https://github.com/Stahldavid/sensegrep/commit/6abb2b1fd3b25384bd89ea3bcb240873454bf1f9) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Harden agent evidence workflows and reduce repeated embedding work.

  - enforce global token, byte, and batch budgets across complete audit runs
  - return compact, deduplicated continuation cards with separate retrieval, context, and emitted-token metrics
  - merge fragmented chunks into logical graph symbols and improve domain-aware executable-code ranking
  - make `--log-format none` fully silent and rename the query embedding deadline to `--embedding-timeout`
  - add duplicate-detection wall-clock timeouts, progress, partial results, and resumable cursors
  - reuse compatible vectors during structural full-index migrations

## 1.10.0

### Minor Changes

- [`734ee52`](https://github.com/Stahldavid/sensegrep/commit/734ee5286dc04f974eec682a2c3ae9978fa89cf6) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Make Sensegrep a safer, progressive code-evidence service for agents.

  - keep diagnostic reads non-destructive, report schema migrations, and retain prior atomic index generations
  - persist file roles and rank results with task-purpose presets
  - report actual retrieval mode, evidence universe, index snapshot, and budgets
  - return compact result cards with deterministic `show`/`expand` navigation and symbol reconstruction
  - add filesystem literal search, complete audit batches, canonical graph selectors, richer edges, and graph coverage
  - add daemon, investigation planning, task evaluation, and command-wide output budgets/dry runs

## 1.9.0

### Minor Changes

- Add deterministic literal search, exact import filtering, canonical call graphs, compact grouped JSON, changed-file audit coverage, and latency-bounded semantic fallback.

  Fix Next.js route handler classification when route bodies call framework APIs, persist full import specifiers and AST call targets in the index, and consolidate search retrieval into one shared pipeline.

## 1.8.0

### Minor Changes

- Add hybrid retrieval and reranking, token-budgeted context, Git audit scope, resumable and reusable indexing, embedding benchmarks, named profiles, code graph analysis, language plugins, and large-index ANN optimization.

## 1.7.6

### Patch Changes

- Harden concurrent indexing with transactional activation, cancellation, validated embedding retries, faster freshness checks, strict tool inputs, and safer credential handling. Indexing now streams bounded embedding batches, reuses parsed syntax trees, rejects stale generated artifacts, and requires Node.js 20 or newer so runtime dependencies remain security-maintained.

## 1.7.5

### Patch Changes

- Make semantic indexing faster and more reliable with model-aware chunk limits, bounded overlap, batched concurrent embedding requests, chunking-signature invalidation, refreshed watched-file metadata, and stricter duplicate filtering.

## 1.7.4

### Patch Changes

- Fix semantic indexing edge cases, duplicate detection self-matches, CLI JSON output, and release artifact validation.

## 1.7.3

### Patch Changes

- Clean package build outputs before compiling, reject malformed embedding response shapes, remove stale index metadata on file updates, and reduce duplicated search utility code.

## 1.7.2

### Patch Changes

- Improve OpenRouter Qwen3 embedding support with configurable batch sizing, OpenRouter metadata headers, smaller output dimensions, and the model's 32K token limit.

## 1.7.1

### Patch Changes

- Remove the experimental fastembed-rs sidecar provider and switch the default local Ollama embedding model to `qwen3-embedding:0.6b` at 1024 dimensions.

## 1.7.0

### Minor Changes

- Add local embedding provider support with Ollama and an experimental fastembed-rs sidecar, including CLI/configuration updates, documentation, duplicate-detection coverage, and provider-scoped config handling.

## 1.6.12

### Patch Changes

- Improve agent-loop ergonomics with fast metadata-only status, exact symbol lookup for short identifier queries, no-shake output control, structured file-filter warnings, search timing metrics, and suppressible JSON progress logs.

## 1.6.8

### Patch Changes

- Reject unknown CLI flags per subcommand, officially support `detect-duplicates --include/--exclude`, and skip unsupported legacy subdirectory index metadata so subdirectory roots can reuse a compatible parent index instead of failing on old local-provider metadata.

## 1.6.7

### Patch Changes

- Improve operational reliability for agents: index runs now expose structured progress phases, timeout budgets, safer max-file smoke runs, and clearer lock-wait reporting. The CLI adds `verify --strict`, `selftest`, JSON-safe index output, and JSONL progress logs on stderr. Semantic kind filters now support aliases such as `convexPrivateMutation` and wildcards such as `convex*`.

## 1.6.6

### Patch Changes

- Fix CLI help/version handling, make incremental indexing avoid partial chunk updates, preserve existing indexes until rebuild embeddings are ready, serialize index writes with a lock, and use explicit cosine distance with metric-aware scores.

## 1.6.5

### Patch Changes

- Keep CLI JSON stdout parseable, remove Windows language-detection shell noise, calibrate confidence for exact structural matches, improve thematic group titles, and expose framework-aware semantic kinds.

## 1.6.4

### Patch Changes

- Make search-time freshness checks best-effort with a short timeout so query tools do not block on filesystem verification.

## 1.6.3

### Patch Changes

- Add index freshness warnings/checks, framework-aware semantic kinds, result confidence explanations, filter match metadata, and more auditable survey/cluster/duplicate outputs.

## 1.6.2

### Patch Changes

- Fix TypeScript async metadata in indexed chunks and allow regex pattern fallback to preserve structural filters such as parent scope.

## 1.6.1

### Patch Changes

- Fix TypeScript class chunking so methods inside small and exported classes are indexed with `parentScope` metadata, allowing `--parent` filters to match class methods reliably.

## 1.6.0

### Minor Changes

- Improve semantic search automation and broad-codebase behavior.

  - Reuse the nearest indexed parent when search, survey, cluster, or duplicate detection runs from a subdirectory.
  - Return structured search results for `search --json`, survey groups for `survey --json`, cluster groups for `cluster --json`, and MCP `structuredContent`.
  - Make `parentScope` and `imports` filters more tolerant for practical narrowing.
  - Add duplicate-detection candidate caps, language filtering, cross-language control, and truncation metadata.
  - Update standalone CLI and plugin MCP skills to document the current behavior.

## 1.5.5

### Patch Changes

- Fix provider-aware embedding API key resolution and improve index watcher error reporting. VS Code extension now defers to `~/.config/sensegrep/config.json` when embedding settings are not explicitly configured, fixing LM Studio and OpenAI-compatible local setups.

## 1.5.4

### Patch Changes

- Fix OpenAI-compatible and Gemini embedding providers to honor `apiKey` from `~/.config/sensegrep/config.json`, so local LM Studio and other config-file-only setups work without extra environment variables.

## 1.5.3

### Patch Changes

- Improve npm discoverability: add/refresh `description` and `keywords` on the published packages so they surface in npm and registry search. No runtime or API changes.

## 1.5.2

### Patch Changes

- [`b155b33`](https://github.com/Stahldavid/sensegrep/commit/b155b33fcdedd80d74ab46d26ea90254a634ca09) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Windows ripgrep fallback batching to avoid ENAMETOOLONG during identifier and pattern-based searches in large repos.

## 1.5.1

### Patch Changes

- [`1ca19af`](https://github.com/Stahldavid/sensegrep/commit/1ca19af9764a39d080e8f7d49b5d34047742d745) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Improve indexing resilience for large and generated repositories.

  This change teaches the indexer to respect project-level include/exclude config, ignore common minified and sourcemap assets by default, split oversized fallback chunks safely, and retry transient Bedrock service errors more gracefully.

## 1.5.0

### Minor Changes

- [`ed8d00a`](https://github.com/Stahldavid/sensegrep/commit/ed8d00a3bdbebbdcdda021ee7119b6202b8e4caf) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add theme-oriented `survey` and `cluster` workflows to sensegrep.

  `survey` groups broad semantic results into readable domains with representative tree-shaken snippets, while `cluster` decomposes wide queries into coherent subthemes using embeddings, AST metadata, path signals, and import hints.

  The release also wires both commands through the CLI, MCP server, README, and bundled skills so they are discoverable everywhere sensegrep is used.

## 1.4.3

### Patch Changes

- [`5dcf54c`](https://github.com/Stahldavid/sensegrep/commit/5dcf54c8378f0e4a1b41caa8fcc7c68939adf9ac) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Improve exact identifier searches by adding an automatic literal fallback on top of semantic search and document the updated behavior in the sensegrep skills.

## 1.4.2

### Patch Changes

- [`82e6e99`](https://github.com/Stahldavid/sensegrep/commit/82e6e997fabea676855e4060048d8a6c3187e740) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Windows file glob filtering by normalizing indexed paths and document the updated sensegrep skill guidance for Java, Vue, and Windows glob usage.

## 1.4.1

### Patch Changes

- [`03da2d1`](https://github.com/Stahldavid/sensegrep/commit/03da2d13c07f8f239727278fd3afd5baba1045c6) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Bedrock indexing failures and improve Vue chunking reliability.

  Re-enable embedding input validation for LanceDB indexing, truncate oversized
  Bedrock payloads, batch requests by payload size, split minified JS chunks
  even inside nested blocks, and index template-only Vue SFCs as component chunks.

## 1.4.0

### Minor Changes

- [`a1a9be6`](https://github.com/Stahldavid/sensegrep/commit/a1a9be6124082ee19c73de2f4ecd5f11774f2e11) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add first-class Vue SFC semantic support across indexing and search.

  Vue single-file components now use tree-sitter-vue to locate script blocks and
  tree-sitter TypeScript/JavaScript for semantic chunking of `<script>` and
  `<script setup>`. Metadata covers Composition API and Options API symbols,
  tree-shaking preserves relevant SFC sections, and the CLI/VS Code surfaces expose
  Vue as a selectable language.

## 1.3.0

### Minor Changes

- [`a4a07ca`](https://github.com/Stahldavid/sensegrep/commit/a4a07cad92b5e6755e58f9238ef8e2a7fc11bba7) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add first-class Java semantic support across indexing and search.

  Java files now use tree-sitter-based semantic chunking with metadata for classes,
  interfaces, records, annotation types, methods, constructors, fields, modifiers,
  Javadoc, imports, and parent scope. Tree-shaking and language discovery also
  support Java, and the CLI/VS Code surfaces expose Java as a selectable language.

## 1.2.1

### Patch Changes

- [`4f893b2`](https://github.com/Stahldavid/sensegrep/commit/4f893b27672de16b7f1c694c9cebf8c85149b943) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Amazon Bedrock authentication to prefer the configured API key token from sensegrep config files instead of falling back to expired AWS credentials.

## 1.2.0

### Minor Changes

- [`97ab4f3`](https://github.com/Stahldavid/sensegrep/commit/97ab4f3e8fd3f7b718ee5fe46b8854c299820e0d) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add native Amazon Bedrock embeddings support centered on Cohere Embed v4, including CLI, MCP, and editor configuration updates.

## 1.1.4

### Patch Changes

- Canonicalize watcher project paths before locking so CLI, MCP, and VS Code share the same watcher lock for the same repository.

## 1.1.3

### Patch Changes

- Remove the extra Gemini countTokens request before embeddings so searches use fewer API calls and are less likely to hit rate limits.

## 1.1.2

### Patch Changes

- Fix file glob filtering by applying include/exclude before semantic limiting, and document the correct Claude Code plugin installation flow.

## 1.1.1

### Patch Changes

- [`ee53444`](https://github.com/Stahldavid/sensegrep/commit/ee534445ffa43060ffad0826fa97603eb1aa75b8) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix early API key validation and VS Code provider detection

  - Indexer now validates embedding provider config (API key presence) before touching the on-disk index, giving a clear error message instead of failing mid-index.
  - VS Code extension: simplify provider detection using `config.get` instead of `config.inspect`; default to `gemini` consistently.

## 1.1.0

### Minor Changes

- [`e484923`](https://github.com/Stahldavid/sensegrep/commit/e484923f3089446bf0d7f19ffd2404a979beb58c) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add proactive rate limiting and exponential backoff retry for embedding requests

  - Rate limiter (sliding window, 1 min) prevents 429s before they happen. Defaults match Gemini free tier: 3,000 RPM and 1,000,000 TPM.
  - Automatic retry with exponential backoff + jitter on 429 responses (6 retries, base delay 1s, max 60s).
  - Fully configurable per user via `~/.config/sensegrep/config.json` (`rateLimit.rpm`, `rateLimit.tpm`, `rateLimit.maxRetries`, `rateLimit.retryBaseDelayMs`) or env vars (`SENSEGREP_RATE_LIMIT_RPM`, `SENSEGREP_RATE_LIMIT_TPM`, `SENSEGREP_MAX_RETRIES`, `SENSEGREP_RETRY_BASE_DELAY_MS`).

## 1.0.0

### Major Changes

- [`87d7d30`](https://github.com/Stahldavid/sensegrep/commit/87d7d30677602967c7dc1b60d447cb9ee0977858) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Remove local embeddings support; switch to remote-only providers (Gemini, OpenAI-compatible)

  The `local` provider (HuggingFace transformers.js + ONNX Runtime) has been removed. All embeddings now use remote APIs. The default provider is now `gemini`.

  **Breaking changes:**

  - `--provider local` is no longer valid; use `gemini` or `openai`
  - `--device` and `--rerank-model` flags are removed
  - `SENSEGREP_EMBED_DEVICE`, `SENSEGREP_RERANK_MODEL`, `OPENCODE_EMBEDDINGS_DEVICE` env vars are removed
  - Default embedding model changed from `BAAI/bge-small-en-v1.5` (384 dim) to `gemini-embedding-001` (768 dim)

## 0.1.22

### Patch Changes

- [`b134dbd`](https://github.com/Stahldavid/sensegrep/commit/b134dbd0887138e8715f713011072ae2cf69e501) Thanks [@Stahldavid](https://github.com/Stahldavid)! - fix(mcp): improve tool name handling, add structured content output, and fix rootDir resolution
