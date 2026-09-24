---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Keep the active index consistent when incremental indexing is interrupted by staging vector changes before atomically switching metadata. Preserve the no-change fast path and reuse existing embeddings. Honor duplicate result limits in every CLI JSON projection with explicit output truncation. Improve default search file diversity and retain meaningful words in cluster labels.
