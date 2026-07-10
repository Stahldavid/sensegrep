---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Harden agent evidence workflows and reduce repeated embedding work.

- enforce global token, byte, and batch budgets across complete audit runs
- return compact, deduplicated continuation cards with separate retrieval, context, and emitted-token metrics
- merge fragmented chunks into logical graph symbols and improve domain-aware executable-code ranking
- make `--log-format none` fully silent and rename the query embedding deadline to `--embedding-timeout`
- add duplicate-detection wall-clock timeouts, progress, partial results, and resumable cursors
- reuse compatible vectors during structural full-index migrations
