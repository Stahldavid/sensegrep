# Integrity corrections: local integration and offline validation

Base: `4663780f6225cc6cb38797aaca215075b238588e` (1.19.0).
Branch: `works/integrity-evidence-contracts`. This is local work, not a release.

## Recovery and review

Recovered the other workspace's implementation through RepoBridge's safe per-file
reader. Whole-patch export remained blocked; no hidden credentials were extracted.
Unredacted files were checked against their SHA-256. Redacted code expressions were
reimplemented locally with existing local code and synthetic test credentials.
The remote workspace was paused again after recovery.

The remote commits were not blindly cherry-picked. Local integration found and fixed
a TypeScript closure-narrowing error and an overstrict metadata comparison in a test.

## Integrated behavior

- Context preserves prerequisite errors; verification failures report unknown freshness.
- Legacy source IDs report unknown freshness; hashed IDs detect edits preserving names.
- A shared source reader bounds bytes, verifies root confinement, file identity and
  ranges, rejects symlinks/junctions, and honors cancellation. This is defense in depth,
  not an OS sandbox against arbitrary concurrent filesystem mutation.
- Audit read failures remain uncovered. Coverage explicitly means file representation,
  not complete review of every changed hunk.
- Overlapping definitions survive package selection. Admission applies limits atomically,
  shares identical sources once, and rejects conflicting identities. Equal symbol names
  in different files remain distinct.
- Vector/lexical ranks remain separate from fusion scores; exclusions and effective
  pipeline configuration are observable.
- Jev stage diagnostics preserve later failures and distinguish known from unknown usage.
  Post-hoc evidence mode preserves the local packet.
- Jev transport bounds concurrency/parsing, honors cancellation, limits transient retries,
  and distinguishes ordinary HTTP 400 from context overflow.
- Watchers capture root/profile; generation queues retain failed work and edits during
  refresh. Ignore changes reconcile; stop cancels and awaits active work.
- Embedding quotas reject impossible batches and support cancellation/deadlines. Retries
  consume quota; changing limits cannot reset an active account quota. The operation
  deadline also aborts in-flight requests. Input indices and finite vectors are validated.
- Duplicate caches have an additional-memory budget, not a total process-memory cap.
- Build locks retain live owners. CI builds once before checks. Evaluation contracts
  validate frozen identities, reviewed alternatives, group separation and failure denominators.
- Anonymous unverified snippets remain partial, not complete implementations.

## Jev default and migration

Explicit `mode: "both"` in `jev.json` preserves Jev as the user's default. Environment
and command overrides remain supported; `local-only` wins. Search/context warn when
a dedicated credential lacks explicit mode, without printing it. No global installation
or stored user configuration was changed.

## Validation

Windows, Node 24.16.0, using existing dependencies:

| Check | Result |
| --- | --- |
| Build including VS Code bundle; workspace TypeScript | Passed |
| Full Vitest | 437 passed in 61 files |
| Native Node contract/evaluation/build tests | 62 passed, zero skipped |
| Python research tests | 26 passed |
| Packaged artifacts | core, CLI and MCP passed |
| Version consistency | 1.19.0 consistent; changeset pending |
| README links and whitespace | Passed |
| Built CLI, unindexed synthetic project | JSON preserves `index-required` |

Provider responses were mocked. A preload guard denied external sockets and allowed
loopback fixtures. Its initial self-test exposed an argument-normalization bug; after
repair, both socket call forms were verified and the full Vitest and Node suites were
rerun successfully. The final migration-warning change was additionally typechecked
and tested in the affected Jev/context/search suites.

No Jev/OpenRouter inference was performed and no API credit was consumed. Provider
warnings in test logs are synthetic responses. The test guard and detailed local logs
are retained under `.git/` and are not part of distributed packages.

## Limits

These checks validate deterministic contracts and mocked behavior, not live Jev quality,
latency or calibration. Historical source-coverage figures do not measure this branch. New
inference, AutoResearch training and semantic comparisons remain deferred under the
user's no-spending instruction.

The configured CI matrix has not run for this local branch. Linux/macOS and live
VS Code/Electron E2E were not executed here. FTS/BM25 replacement, compiler-grade
cross-language resolution and copy-on-write indexing remain separate work.
No push, merge, release or global CLI update was performed in this task.
