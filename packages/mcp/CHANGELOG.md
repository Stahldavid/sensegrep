# @sensegrep/mcp

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
