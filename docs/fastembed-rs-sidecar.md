# Experimental fastembed-rs sidecar

Sensegrep can use an experimental local fastembed-rs sidecar for code embeddings. Initial support is intentionally narrow and supports only:

- provider: `fastembed`
- model: `jinaai/jina-embeddings-v2-base-code`
- dimension: `768`
- default base URL: `http://127.0.0.1:11435/v1`

The sidecar exposes an OpenAI-compatible embeddings endpoint:

```text
POST /v1/embeddings
```

Request shape:

```json
{
  "model": "jinaai/jina-embeddings-v2-base-code",
  "input": ["find auth flow", "find retry logic"]
}
```

Response shape:

```json
{
  "object": "list",
  "model": "jinaai/jina-embeddings-v2-base-code",
  "data": [
    { "object": "embedding", "index": 0, "embedding": [0.1, 0.2] }
  ]
}
```

## Run the sidecar from source

Requires Rust/Cargo on the machine running the server:

```bash
cargo run --manifest-path crates/fastembed-server/Cargo.toml --release -- \
  --host 127.0.0.1 \
  --port 11435 \
  --model jinaai/jina-embeddings-v2-base-code
```

The first run downloads the model through fastembed-rs/Hugging Face and then reuses the local cache.

## Configure Sensegrep

```bash
export SENSEGREP_PROVIDER=fastembed
export SENSEGREP_FASTEMBED_BASE_URL=http://127.0.0.1:11435/v1
export SENSEGREP_EMBED_MODEL=jinaai/jina-embeddings-v2-base-code
export SENSEGREP_EMBED_DIM=768

sensegrep selftest --root .
sensegrep index --root . --full --no-watch
sensegrep search "auth flow"
```

Or `~/.config/sensegrep/config.json`:

```json
{
  "provider": "fastembed",
  "baseUrl": "http://127.0.0.1:11435/v1",
  "embedModel": "jinaai/jina-embeddings-v2-base-code",
  "embedDim": 768
}
```

## Notes

- This does not add `onnxruntime-node` to the Node packages. ONNX stays isolated inside the Rust sidecar through fastembed-rs.
- Changing from Ollama/Gemini/OpenAI-compatible/Bedrock to fastembed requires a full reindex.
- Initial support is deliberately limited to Jina code embeddings to avoid a broad model-management surface before benchmarking.
