# Token-aware chunking and local Ollama

The embedding model's capacity, Ollama's runtime context, chunk budgets, and
`context --max-tokens` are independent. The last option limits **search output**;
it does not configure indexing or the embedding server.

Global configuration (`~/.config/sensegrep/config.json`):

```json
{
  "provider": "ollama",
  "embedModel": "qwen3-embedding:0.6b",
  "embedDim": 1024,
  "baseUrl": "http://127.0.0.1:11434",
  "contextTokens": 8192,
  "tokenizerPath": "C:/path/to/qwen3-tokenizer.json",
  "batchTokens": 16384,
  "chunking": {
    "targetTokens": 2048,
    "preserveTokens": 4096,
    "maxTokens": 7000,
    "overlapTokens": 128
  }
}
```

`tokenizerPath` is optional. It must point to a local Hugging Face `tokenizer.json`
matching the embedding model. Sensegrep does not download tokenizers or send code
to Hugging Face. For Qwen3-Embedding-0.6B, obtain the tokenizer from the
[official model repository at a pinned revision](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/resolve/fdbdb0320177f59749e02fd66fbdc86082872ef0/tokenizer.json).
No Python runtime or transformer model weights are needed for token counting.
An invalid explicit tokenizer path fails visibly. Without a tokenizer, counts
are estimates (`UTF-8 bytes / 3`), not a guarantee that the input fits.

The default AST policy preserves cohesive symbols up to `preserveTokens` and
aims for `targetTokens` when splitting larger symbols. Complexity no longer
forces 800/1200/1800-token caps. AST boundary selection still uses character
approximations; the final complete input, including metadata and overlap, is
measured against `maxTokens` and split without dropping text before IDs and
vectors are created. Fallback fragments retain conservative source spans.
Large classes retain method-level chunks. Increasing budgets does not merge
unrelated functions into a single embedding.

The effective maximum is capped by the configured runtime window, with a 2%
reserve (at least 32 tokens). Bedrock retains its separate character constraint.
Defaults are starting points, not a claim that larger chunks improve retrieval
or indexing speed on every repository.

For Ollama, Sensegrep checks `/api/show` for the installed model's context
capacity, caps the requested window accordingly, and sends `options.num_ctx`
and `truncate: false` to `/api/embed`. Oversized inputs fail rather than returning
vectors for silently shortened code. If estimates differ from the server's
tokenizer, install the matching tokenizer or lower the chunk maximum and rebuild.
Unknown Ollama models use a conservative 2048-token capacity for offline planning;
`maxInputTokens` supplies a verified model capacity override. It does not replace
`contextTokens`. Runtime discovery is cached per endpoint/model for the process.

HTTP batches obey both the document-count limit (`SENSEGREP_OLLAMA_BATCH_SIZE`,
default 16) and `batchTokens`. One valid document above the aggregate batch target
is sent alone. Full-index plans account for both limits; request counts remain
estimates and exclude retries and the model-metadata request.

Environment equivalents:

| Configuration | Environment variable |
| --- | --- |
| `contextTokens` | `SENSEGREP_CONTEXT_TOKENS` |
| `tokenizerPath` | `SENSEGREP_TOKENIZER_PATH` |
| `batchTokens` | `SENSEGREP_BATCH_TOKENS` |
| `chunking.targetTokens` | `SENSEGREP_CHUNK_TARGET_TOKENS` |
| `chunking.preserveTokens` | `SENSEGREP_CHUNK_PRESERVE_TOKENS` |
| `chunking.maxTokens` | `SENSEGREP_CHUNK_MAX_TOKENS` |
| `chunking.overlapTokens` | `SENSEGREP_CHUNK_OVERLAP_TOKENS` |

Explicit API overrides take precedence over environment variables, then global
configuration. Effective target/preserve/max values are clamped in that order.
Use `sensegrep selftest --json` to inspect the resolved input policy and tokenizer
identity without calling the embedding server. The tokenizer content digest and
effective chunk policy participate in index signatures: `index --no-watch`
rebuilds an incompatible index, and watch updates reject mixed policies.

Compare settings with separate `--profile` indexes. Profiles isolate indexes;
they do not persist configuration, so use the same environment when searching.
For a repeatable local Qwen comparison, build the CLI and run:

```text
node scripts/benchmark-chunk-policy.mjs ROOT TOKENIZER CASES_JSON OUTPUT_DIRECTORY
```

The cases file is an array of `{ "name": "auth", "query": "...", "expected": "src/auth.ts" }`.
The script compares compact (1K target/2K preserve), balanced (2K/4K), and large
(4K/4K) policies with a shared 7K maximum and 8K Ollama window. It records index
wall time and top-5 retrieval, runs sequentially, disables query-vector caching,
and keeps global configuration and the default index unchanged. Run against fresh
profile names/directories for cold indexing measurements: full rebuilds may reuse
compatible vectors in existing profiles. Compare VRAM and end-to-end timings too;
fewer vectors alone do not prove a faster index.
