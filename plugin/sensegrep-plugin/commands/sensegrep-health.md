---
description: Check index health and project language coverage for sensegrep
allowed-tools:
  - "mcp__plugin_sensegrep_sensegrep__sensegrep_stats"
  - "mcp__plugin_sensegrep_sensegrep__sensegrep_languages"
---

Run this sequence:
1. Call `mcp__plugin_sensegrep_sensegrep__sensegrep_stats`.
2. Call `mcp__plugin_sensegrep_sensegrep__sensegrep_languages` with `detect: true`.
3. If requested, call `mcp__plugin_sensegrep_sensegrep__sensegrep_languages` with `variants: true`.

Report:
- Index readiness and any obvious issues.
- Detected languages and suggested filters.
- One next action to improve search quality.
