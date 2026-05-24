# @sensegrep/mcp

## 1.4.2

### Patch Changes

- [`82e6e99`](https://github.com/Stahldavid/sensegrep/commit/82e6e997fabea676855e4060048d8a6c3187e740) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Windows file glob filtering by normalizing indexed paths and document the updated sensegrep skill guidance for Java, Vue, and Windows glob usage.

- Updated dependencies [[`82e6e99`](https://github.com/Stahldavid/sensegrep/commit/82e6e997fabea676855e4060048d8a6c3187e740)]:
  - @sensegrep/core@1.4.2

## 1.4.1

### Patch Changes

- [`03da2d1`](https://github.com/Stahldavid/sensegrep/commit/03da2d13c07f8f239727278fd3afd5baba1045c6) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Bedrock indexing failures and improve Vue chunking reliability.

  Re-enable embedding input validation for LanceDB indexing, truncate oversized
  Bedrock payloads, batch requests by payload size, split minified JS chunks
  even inside nested blocks, and index template-only Vue SFCs as component chunks.

- Updated dependencies [[`03da2d1`](https://github.com/Stahldavid/sensegrep/commit/03da2d13c07f8f239727278fd3afd5baba1045c6)]:
  - @sensegrep/core@1.4.1

## 1.4.0

### Minor Changes

- [`a1a9be6`](https://github.com/Stahldavid/sensegrep/commit/a1a9be6124082ee19c73de2f4ecd5f11774f2e11) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add first-class Vue SFC semantic support across indexing and search.

  Vue single-file components now use tree-sitter-vue to locate script blocks and
  tree-sitter TypeScript/JavaScript for semantic chunking of `<script>` and
  `<script setup>`. Metadata covers Composition API and Options API symbols,
  tree-shaking preserves relevant SFC sections, and the CLI/VS Code surfaces expose
  Vue as a selectable language.

### Patch Changes

- Updated dependencies [[`a1a9be6`](https://github.com/Stahldavid/sensegrep/commit/a1a9be6124082ee19c73de2f4ecd5f11774f2e11)]:
  - @sensegrep/core@1.4.0

## 1.3.0

### Minor Changes

- [`a4a07ca`](https://github.com/Stahldavid/sensegrep/commit/a4a07cad92b5e6755e58f9238ef8e2a7fc11bba7) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add first-class Java semantic support across indexing and search.

  Java files now use tree-sitter-based semantic chunking with metadata for classes,
  interfaces, records, annotation types, methods, constructors, fields, modifiers,
  Javadoc, imports, and parent scope. Tree-shaking and language discovery also
  support Java, and the CLI/VS Code surfaces expose Java as a selectable language.

### Patch Changes

- Updated dependencies [[`a4a07ca`](https://github.com/Stahldavid/sensegrep/commit/a4a07cad92b5e6755e58f9238ef8e2a7fc11bba7)]:
  - @sensegrep/core@1.3.0

## 1.2.1

### Patch Changes

- [`4f893b2`](https://github.com/Stahldavid/sensegrep/commit/4f893b27672de16b7f1c694c9cebf8c85149b943) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix Amazon Bedrock authentication to prefer the configured API key token from sensegrep config files instead of falling back to expired AWS credentials.

- Updated dependencies [[`4f893b2`](https://github.com/Stahldavid/sensegrep/commit/4f893b27672de16b7f1c694c9cebf8c85149b943)]:
  - @sensegrep/core@1.2.1

## 1.2.0

### Minor Changes

- [`97ab4f3`](https://github.com/Stahldavid/sensegrep/commit/97ab4f3e8fd3f7b718ee5fe46b8854c299820e0d) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add native Amazon Bedrock embeddings support centered on Cohere Embed v4, including CLI, MCP, and editor configuration updates.

### Patch Changes

- Updated dependencies [[`97ab4f3`](https://github.com/Stahldavid/sensegrep/commit/97ab4f3e8fd3f7b718ee5fe46b8854c299820e0d)]:
  - @sensegrep/core@1.2.0

## 1.1.4

### Patch Changes

- Canonicalize watcher project paths before locking so CLI, MCP, and VS Code share the same watcher lock for the same repository.

- Updated dependencies []:
  - @sensegrep/core@1.1.4

## 1.1.3

### Patch Changes

- Remove the extra Gemini countTokens request before embeddings so searches use fewer API calls and are less likely to hit rate limits.

- Updated dependencies []:
  - @sensegrep/core@1.1.3

## 1.1.2

### Patch Changes

- Fix file glob filtering by applying include/exclude before semantic limiting, and document the correct Claude Code plugin installation flow.

- Updated dependencies []:
  - @sensegrep/core@1.1.2

## 1.1.1

### Patch Changes

- [`ee53444`](https://github.com/Stahldavid/sensegrep/commit/ee534445ffa43060ffad0826fa97603eb1aa75b8) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Fix early API key validation and VS Code provider detection

  - Indexer now validates embedding provider config (API key presence) before touching the on-disk index, giving a clear error message instead of failing mid-index.
  - VS Code extension: simplify provider detection using `config.get` instead of `config.inspect`; default to `gemini` consistently.

- Updated dependencies [[`ee53444`](https://github.com/Stahldavid/sensegrep/commit/ee534445ffa43060ffad0826fa97603eb1aa75b8)]:
  - @sensegrep/core@1.1.1

## 1.1.0

### Minor Changes

- [`e484923`](https://github.com/Stahldavid/sensegrep/commit/e484923f3089446bf0d7f19ffd2404a979beb58c) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add proactive rate limiting and exponential backoff retry for embedding requests

  - Rate limiter (sliding window, 1 min) prevents 429s before they happen. Defaults match Gemini free tier: 3,000 RPM and 1,000,000 TPM.
  - Automatic retry with exponential backoff + jitter on 429 responses (6 retries, base delay 1s, max 60s).
  - Fully configurable per user via `~/.config/sensegrep/config.json` (`rateLimit.rpm`, `rateLimit.tpm`, `rateLimit.maxRetries`, `rateLimit.retryBaseDelayMs`) or env vars (`SENSEGREP_RATE_LIMIT_RPM`, `SENSEGREP_RATE_LIMIT_TPM`, `SENSEGREP_MAX_RETRIES`, `SENSEGREP_RETRY_BASE_DELAY_MS`).

### Patch Changes

- Updated dependencies [[`e484923`](https://github.com/Stahldavid/sensegrep/commit/e484923f3089446bf0d7f19ffd2404a979beb58c)]:
  - @sensegrep/core@1.1.0

## 1.0.0

### Major Changes

- [`87d7d30`](https://github.com/Stahldavid/sensegrep/commit/87d7d30677602967c7dc1b60d447cb9ee0977858) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Remove local embeddings support; switch to remote-only providers (Gemini, OpenAI-compatible)

  The `local` provider (HuggingFace transformers.js + ONNX Runtime) has been removed. All embeddings now use remote APIs. The default provider is now `gemini`.

  **Breaking changes:**

  - `--provider local` is no longer valid; use `gemini` or `openai`
  - `--device` and `--rerank-model` flags are removed
  - `SENSEGREP_EMBED_DEVICE`, `SENSEGREP_RERANK_MODEL`, `OPENCODE_EMBEDDINGS_DEVICE` env vars are removed
  - Default embedding model changed from `BAAI/bge-small-en-v1.5` (384 dim) to `gemini-embedding-001` (768 dim)

### Patch Changes

- Updated dependencies [[`87d7d30`](https://github.com/Stahldavid/sensegrep/commit/87d7d30677602967c7dc1b60d447cb9ee0977858)]:
  - @sensegrep/core@1.0.0

## 0.1.22

### Patch Changes

- [`b134dbd`](https://github.com/Stahldavid/sensegrep/commit/b134dbd0887138e8715f713011072ae2cf69e501) Thanks [@Stahldavid](https://github.com/Stahldavid)! - fix(mcp): improve tool name handling, add structured content output, and fix rootDir resolution

- Updated dependencies [[`b134dbd`](https://github.com/Stahldavid/sensegrep/commit/b134dbd0887138e8715f713011072ae2cf69e501)]:
  - @sensegrep/core@0.1.22
