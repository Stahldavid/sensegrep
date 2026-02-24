---
description: Detect logical code duplicates and rank refactor opportunities
allowed-tools: ["mcp__plugin_sensegrep_sensegrep__sensegrep_detect_duplicates"]
---

Call `mcp__plugin_sensegrep_sensegrep__sensegrep_detect_duplicates` with a practical baseline:

- `crossFileOnly: true`
- `ignoreTests: true`
- `threshold: 0.85`
- `limit: 20`

If the user asks for strict detection, raise `threshold` (for example 0.9+).
If the user asks for broader discovery, lower `threshold` (for example 0.8).

Present:
1. Highest-impact duplicate groups first.
2. Why each group is a refactoring candidate.
3. A low-risk consolidation strategy per group.
