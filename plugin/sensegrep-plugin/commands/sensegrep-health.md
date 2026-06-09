---
description: Check index health and project language coverage for sensegrep
allowed-tools:
  - "mcp__plugin_sensegrep_sensegrep__sensegrep_index"
---

Run this sequence:
1. Call `mcp__plugin_sensegrep_sensegrep__sensegrep_index` with `action: "stats"`.
2. Inspect index readiness, file/chunk counts, provider metadata, and freshness fields when present.
3. If the user explicitly needs language inventory or language variants, tell them that this is intentionally CLI-only and suggest `sensegrep languages --detect` or `sensegrep languages --variants`.

Report:
- Index readiness and any obvious issues.
- Suggested search filters based on the user's target area, when obvious.
- One next action to improve search quality, such as indexing incrementally or scoping with `include`.
