---
"@sensegrep/core": major
"@sensegrep/cli": major
"@sensegrep/mcp": major
---

Remove local embeddings support; switch to remote-only providers (Gemini, OpenAI-compatible)

The `local` provider (HuggingFace transformers.js + ONNX Runtime) has been removed. All embeddings now use remote APIs. The default provider is now `gemini`.

**Breaking changes:**
- `--provider local` is no longer valid; use `gemini` or `openai`
- `--device` and `--rerank-model` flags are removed
- `SENSEGREP_EMBED_DEVICE`, `SENSEGREP_RERANK_MODEL`, `OPENCODE_EMBEDDINGS_DEVICE` env vars are removed
- Default embedding model changed from `BAAI/bge-small-en-v1.5` (384 dim) to `gemini-embedding-001` (768 dim)
