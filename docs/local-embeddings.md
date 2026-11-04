# Local embeddings with Ollama

Sensegrep can use `qwen3-embedding:0.6b` through Ollama. Install the model on the machine running Ollama with `ollama pull qwen3-embedding:0.6b`. Model installation downloads weights; inference then runs locally. It does not require a paid inference provider.

Set `provider` to `ollama`, `embedModel` to `qwen3-embedding:0.6b`, `embedDim` to `1024` and `baseUrl` to `http://127.0.0.1:11434` in the selected executor's `sensegrep/config.json` under its XDG configuration directory. Token counting also requires the matching tokenizer JSON: `tokenizerPath` must name an existing file on that executor. A Windows absolute path cannot be used by a Linux process.

On WSL, first check whether the Linux executor can reach Ollama's loopback endpoint. If Ollama runs on Windows and Windows localhost is unavailable from WSL, keep Ollama bound to Windows loopback. A WSL loopback listener can forward each connection through Windows Node and [the fixed-destination stdio helper](../scripts/ollama-windows-pipe.cjs). For example, `socat TCP-LISTEN:11434,bind=127.0.0.1,reuseaddr,fork EXEC:/absolute/path/to/windows-node-wrapper` works when the wrapper invokes Windows Node with the helper's Windows path. The wrapper must preserve the environment's WSL interop binding; a persistent user service must be checked after a WSL restart. Bind the listener only to `127.0.0.1` and do not expose the model service publicly.

Use `SENSEGREP_NETWORK_POLICY=local-only` for local indexing and retrieval. Confirm the resolved provider, endpoint, tokenizer and vector dimension before indexing; changing the model does not convert an existing index. Explicitly rebuild an incompatible profile when needed.

## Installation validated on 2026-11-04

The selected WSL executor was corrected to use its Linux tokenizer file. Windows Ollama stores the downloaded model under the Windows user's `.ollama/models` directory; Sensegrep does not store model weights inside the repository. The model manifest reported digest `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d`, 639,150,858 bytes, Q8_0 quantization and 1,024 embedding dimensions.

A real local embedding request through the WSL loopback bridge produced one finite 1,024-dimensional vector. The matching tokenizer counted 18 tokens for the small TypeScript sample. Cold inference took approximately 40.7 seconds; this single sample includes model loading and is not a latency benchmark. No remote inference or paid provider was used. Personal configuration, tokenizer files, model weights and service state are outside the published packages.
