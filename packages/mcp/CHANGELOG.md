# @sensegrep/mcp

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
