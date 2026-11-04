---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": patch
---

Add opt-in repository-scoped copy-on-write worktree views with independent dirty state, compatible cold bootstrap, native shared cache budgets, dependency-aware collection, lifecycle release and repository storage admission. Share source and embedding objects only within explicitly registered repository scopes. Transfer source snapshots with a versioned manifest/object protocol that resumes from verified objects, stores deduplicated replicas and exposes pin/unpin/GC commands. Preserve legacy private indexing and embedded snapshot reads; unknown runtime/plugin identities disable cross-checkout seeding.
