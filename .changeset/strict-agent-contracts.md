---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Make agent output contracts strict, structured, and substantially faster.

- enforce output byte budgets against complete serialized CLI and MCP payloads
- return typed JSON errors with argument exit code 2
- preserve retrieval, universe, index, budget, warning, and filter explanation metadata
- default survey and cluster agent output to summary and propagate lexical fallback warnings
- add lightweight filesystem literal and show entry points
- persist graph snapshots for fast references and impact calls
- support clustering against readable legacy schemas without optional metadata columns
