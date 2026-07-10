---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Add agent-focused JSON projections and enforce physical output budgets.

- add minimal, content, diagnostic, and full projections, with compact as a compatibility alias
- minify JSON by default and add `--pretty` and `--diagnostic` opt-ins
- remove duplicate metadata and source code from ordinary agent output
- expose final rank scores, audit ranges, and explicit semantic and textual coverage
- enforce `maxOutputBytes` against final serialized CLI and MCP payloads
- reduce literal, references, and duplicate-detection schemas
