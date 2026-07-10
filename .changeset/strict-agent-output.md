---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Make agent output limits and structured schemas precise.

- split large changed files into stable ranges so every audit batch strictly respects `batchTokens`
- separate attempted evidence size from the bytes and tokens actually emitted by the CLI
- use canonical search-result fields consistently across compact, content, CLI, and MCP output
- add standard command envelopes to duplicate detection results
- derive snippet integrity from persisted AST symbol regions without adding parsing to normal searches
