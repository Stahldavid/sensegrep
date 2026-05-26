---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Fix Windows ripgrep fallback batching to avoid ENAMETOOLONG during identifier and pattern-based searches in large repos.
