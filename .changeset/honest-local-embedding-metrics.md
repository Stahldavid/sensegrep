---
"@sensegrep/core": patch
"@sensegrep/cli": patch
---

Report sequential embedding benchmarks as baselines without ineffective concurrency recommendations, and avoid recommending concurrency when all inputs fit in one HTTP batch. `recommendedConcurrency` is now null when no comparison is possible.

Distinguish index batches from Ollama HTTP request estimates, including incremental file boundaries. Align reranking help and local CLI guidance with runtime behavior.
