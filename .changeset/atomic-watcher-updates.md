---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Extend staged, atomic index activation to individual watched file updates and removals, including files that become ignored or empty. Validate the staged chunk count before committing metadata and leave the active generation untouched if persistence or metadata writing fails.
