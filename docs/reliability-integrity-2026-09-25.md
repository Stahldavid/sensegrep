# Integrity, evidence and reliability implementation

Local integration and completed offline checks are recorded in the
[2026-09-26 validation report](integrity-local-validation-2026-09-26.md).
The environment limitations below describe the original remote workspace.

Date: 2026-09-25. Base: `4663780f6225cc6cb38797aaca215075b238588e`.
Status: implemented on an isolated work branch; full integration validation is still required before merge. No release, merge or paid inference was performed.

## Delivered changes

### Source and operational integrity

The new `packages/core/src/file/source-reader.ts` centralizes bounded UTF-8 reads, root confinement, regular-file checks, opened-file identity, cancellation and line-range validation. Symbolic links in relative source paths are rejected. Linux additionally checks the opened descriptor path; this is defense in depth, not an OS sandbox or a guarantee against privileged concurrent filesystem changes.

`show` no longer marks a nonexistent line range complete. Extended result IDs can include a normalized source-span SHA-256; modifying a function without renaming it invalidates freshness. Four-field legacy IDs remain accepted, but report freshness as unknown. Search reconstruction reuses a per-operation read cache, verifies available indexed SHA-1 hashes and does not use stale ranges as assessed evidence. Unverified or incomplete reconstructed snippets remain explicitly truncated/partial. Helper and same-file constant reads use the same confinement layer.

`context` preserves `index-required`, `migration-required` and incompatible-embedding statuses instead of rewriting them to complete. Index verification timeout/error becomes unknown, not fresh. Audit continuation does not replace read failures with an empty string. Missing/illegible sources remain uncovered; coverage is explicitly file representation and does not claim changed-hunk exhaustiveness.

### Jev packages and diagnostics

`packet-selection.ts` and `source-identity.ts` implement atomic physical-source admission. A method intersecting a larger root definition cannot substitute for that root. Exactly matching complete sources are shared; different overlapping definitions remain separate and count against budgets. Conflicting source identities, source limits, explicit per-file/per-symbol limits and estimated token budgets are checked before admission.

Original vector and lexical ranks/scores remain distinct from the historical fused score. Package shortlisting uses original vector provenance rather than relabeling a fused lexical score as vector relevance. Diagnostic traces include retrieved, expanded universe, nominated, assessed and selected source stages. Oversized or over-budget pre-assessment exclusions remain visible.

`stage-diagnostics.ts` aggregates phase results and failure reasons without presenting an early successful phase as complete end-to-end evaluation. Provider usage gaps are exposed through `unknownUsageRequests`/`usageComplete`; cost remains the known reported subtotal. The evidence contract is versioned as `evidence-v12-integrity-contract-1`, so stale decision caches cannot silently reuse the prior policy identity.

`jev-transport.ts` provides process-wide four-request admission, caller-signal cancellation, bounded JSON parsing and at most one retry for transient failures. It respects Retry-After without shortening long delays. Authentication and credit rejection are not retried. Only recognized context overflow triggers batch splitting; arbitrary 400 errors do not. Error prose is not copied into evidence.

Evidence-only mode retains the original local packet. Package context uses the standard both-mode path; explicit alternate panels/ranking/batches/block ablations take the symbol path, with the effective configuration and reason exposed. A single-word query no longer bypasses Jev solely because it matches an identifier-like regular expression.

### Watchers, quotas and memory

`refresh-queue.ts` coalesces changes by generation. Failed work stays pending even without another filesystem event. Events arriving during a refresh require a later refresh; stop aborts and awaits active work. A watcher captures an explicit validated profile, uses a root/profile lock, and invalidates filters when ignore policy changes. Initialization and stop failures release owned locks without abandoning active writes.

`rate-limiter.ts` replaces the previous singleton quota loop with per-identity FIFO queues. Cancellation/deadlines apply to queue waits; a batch larger than the entire configured token window fails promptly. OpenAI-compatible embedding indices must correspond one-to-one with input positions, and their coordinates must be numeric and finite. Existing vector dimension/count checks remain.

Duplicate distance/vector cache planning now includes an explicit additional-allocation budget, `SENSEGREP_DUPLICATE_MEMORY_MIB` (default 128). It preserves the current small-set in-memory algorithm when it fits and falls back to the vector store otherwise. This bound excludes already-loaded source/vector objects. Agent output explicitly states that duplicate behavioral equivalence is not proven.

Atomic index generation copying is preserved. New mutation timing logs expose full-copy and mutation costs; no unvalidated copy-on-write replacement is claimed.

### Output, build and evaluation tooling

Default search/context output uses compact evidence and Jev diagnostics. Detailed distributions, source traces and selection records remain diagnostic-only. Source token estimates, serialized estimates and bytes are named separately, while legacy `usedTokens` remains supported. Post-serialization packet changes continue to invalidate strong evidence claims.

Build locks have owner tokens and PID liveness checks; a live slow builder is not evicted by age. Development uses Node 24 through `.nvmrc`; the declared tooling floor is `^20.19.0 || ^22.12.0 || >=24.0.0`. Published package runtime engines were not raised merely because development dependencies need newer Node.

CI builds once, then uses direct typecheck and Vitest commands. Native evaluator/runtime tests, Python research tests, release artifact verification and README link checking are wired separately. The VS Code package was already built and typechecked by the root build; an editor E2E run is still a separate requirement.

`scripts/evaluation-contract.mjs` validates full code/index/model identities, reviewed cases, alternative acceptable source sets and repository/family split isolation across snapshots. It keeps failures/missing cases in denominators, distinguishes absent telemetry from a demonstrated miss and can freeze hash-verified artifact manifests without overwriting a prior registration. It does not manufacture a new holdout, recover missing historical artifacts or prove that a reviewer never inspected private labels.

## Privacy migration

A dedicated Jev credential alone no longer enables transmission. Existing credential storage remains supported; select a mode explicitly:

```sh
sensegrep search "authentication flow" --jev both --json
sensegrep context "requested business rule" --jev both --max-tokens 4000 --limit 5 --json
```

For persistent consent, set `SENSEGREP_JEV_MODE=both` or add `mode: "both"` to the user's `jev.json`. Do not commit credentials. Mode precedence is network policy, explicit command, environment, user configuration, then off.

To deny remote inference and automatic downloads while allowing already-installed loopback providers:

```sh
SENSEGREP_NETWORK_POLICY=local-only sensegrep search "authentication flow" --json
```

`context` defaults remain 12,000 estimated source tokens and limit 50. Package context defaults to 32 candidates and 30 seconds; symbol search defaults to 20 candidates and eight seconds. These are not the historical benchmark's 4,000-token/five-package configuration. Review `jev.effectiveConfig` when comparing runs. Restart older watcher processes after migration because lock identity now includes the profile.

## Validation actually performed

| Check | Observed result |
| --- | --- |
| Strict standalone TypeScript compilation | 11 dependency-free runtime modules passed in local Node 22.16.0 environment |
| Native tests against those actual compiled modules | 32 passed, 0 failed, 0 skipped |
| Repository native tests runnable without dependency installation | 21 passed; four other test files could not start because built core/TypeScript dependencies are absent |
| Python research unit tests | 26 passed (3 + 18 + 5) |
| Version consistency | Passed; published package versions remain 1.19.0 |
| README relative links | Passed |
| Whitespace diff check | Passed at validation checkpoints; rerun before commit |
| Full workspace build/typecheck/Vitest | Not run successfully in the offline RepoBridge workspace |
| Packaged CLI/MCP and editor integration | Not independently run for this branch |
| Live Jev quality/latency/cost evaluation | Not run; no paid inference |

The 21 runnable repository tests include the four new build-lock and eight evaluation-contract tests; do not count these twice. The 32 native runtime tests include the earlier six source-reader probes; do not count those separately. New Vitest regressions were added for statuses, stale reconstruction, freshness, unreadable audit sources, transport, quotas, duplicate memory and source identity, but are not claimed as executed.

Blocked native files: `evaluate-jev-frozen.test.mjs`, `evaluate-jev-reviewed.test.mjs`, `jev-discovery-round.test.mjs`, `research-jev-sufficiency.test.mjs`. The failures were module-loading errors for missing `core/dist` or `typescript`, not observed assertion failures. They remain required checks, not waived tests.

The RepoBridge workspace has Node 20.9.0, no installed dependency set and project network access disabled. The base commit's successful GitHub CI is not validation of these modifications. An unqualified claim that the entire branch is green would be incorrect.

After preparing the declared development runtime and dependencies, required validation is:

```sh
npm ci
npm run build
npm run check:types
npm run test:unit
npm run test:node
npm run test:python
npm run version:check
npm run release:verify
npm run check:docs
npm test --workspace sensegrep
```

The native runtime suite is `scripts/core-runtime-contracts.test.mjs`; it normally imports built core modules and supports `SENSEGREP_CORE_DIST` for a separately compiled validation directory. All its inputs are synthetic and provider responses are mocked.

## Work intentionally not represented as complete

The lexical engine still uses the existing bounded ripgrep/hybrid implementation; no new FTS/BM25 engine has been promoted. Compiler-grade TypeScript alias/re-export resolution and equivalent multilingual graph resolution remain outstanding. Source-safe graph reads and missing-definition reporting are not substitutes for those features.

The full-copy atomic index strategy remains; write amplification is now observable, not eliminated. No fresh multi-repository holdout, new calibrated model or AutoResearch policy was trained/promoted. Historical v12 source-coverage figures do not validate this branch, and no speedup or new answer-accuracy result is claimed. Full output typing, hosted multi-tenant authorization, exhaustive changed-hunk auditing and editor E2E validation remain separate work.

The implementation is preserved in an isolated local branch. Current RepoBridge project policy does not authorize remote push or PR creation. A standard patch export was rejected by its safety filter; no alternate export was used to bypass that rejection. Review and complete validation before remote publication or release.
