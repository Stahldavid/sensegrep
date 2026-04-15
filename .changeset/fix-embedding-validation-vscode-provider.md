---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Fix early API key validation and VS Code provider detection

- Indexer now validates embedding provider config (API key presence) before touching the on-disk index, giving a clear error message instead of failing mid-index.
- VS Code extension: simplify provider detection using `config.get` instead of `config.inspect`; default to `gemini` consistently.
