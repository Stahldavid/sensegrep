---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Preserve operational failures, source identity and atomic evidence packages. Add bounded source reads, unknown freshness, cancellable quota queues, phase diagnostics, original retrieval-channel provenance, watcher profile isolation and retry-safe refresh scheduling. Limit duplicate distance-cache allocations and reduce default diagnostic payloads.

Privacy migration: a dedicated Jev key no longer implicitly enables source transmission. Select an explicit Jev mode, or set `SENSEGREP_NETWORK_POLICY=local-only` to deny remote inference and downloads. Existing credential storage and legacy result IDs remain supported; legacy IDs report unknown freshness.

Development/CI now builds once before direct type/test commands and includes native contract tests and grouped evaluation-registration validation. No new semantic benchmark or calibration claim accompanies these changes.
