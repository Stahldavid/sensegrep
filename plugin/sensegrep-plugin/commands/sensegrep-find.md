---
description: Semantic search with optional filters via sensegrep
argument-hint: [natural-language-query]
allowed-tools: ["mcp__plugin_sensegrep_sensegrep__sensegrep_search"]
---

Use `mcp__plugin_sensegrep_sensegrep__sensegrep_search` to answer the user request.

Execution rules:
1. Treat `$ARGUMENTS` as the semantic query. If empty, ask for a query before calling tools.
2. Start with a broad call using only `query` and `limit=20`.
3. If results are noisy, refine with one or more of: `symbolType`, `language`, `include`, `isAsync`, `isExported`, `minComplexity`, `pattern`.
4. Return concise findings with clickable file paths and why each result is relevant.
5. If no results are found, suggest one narrower and one broader follow-up query.
