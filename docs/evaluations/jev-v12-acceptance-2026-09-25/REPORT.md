# Jev v12: implementation and final acceptance

Date: 2026-09-25. Local implementation; no release or global installation performed.

## Changes

- Interleave local and vector candidates so truncation cannot erase the local reservation.
- Add bounded file discovery before full-source evaluation: up to 240 retrieved rows, 160 file catalogs, 12 excerpts per catalog, and six seconds within the overall deadline. Catalogs nominate sources; they never prove an answer.
- Separate domain compatibility from useful evidence, including useful negative answers. Unrelated service implementations cannot qualify solely through behavioral similarity.
- Select implementation packages within the real token budget. Preserve a strong alternative implementation and, when independently justified, a directly linked caller matching an explicit query term.
- Assess additional packages against already selected code rather than filling the package limit automatically.
- Preserve the actual local packet on fallback. Mark unresolved known dependencies as incomplete while excluding built-ins and callback parameters from false dependency obligations.
- Expose discovery and selection diagnostics; use a 30-second default deadline for package context. Explicit overrides remain supported.
- Extend the research budget only through recorded authorization, preserving previous spending and uncertain reservations.

These are bounded application rules and Jev judgments, not newly trained or calibrated weights.

## Final frozen run

Configuration: original 30-case manifest and reference bindings, 4,000 context tokens, maximum five packages, 32 full-package candidates, 30-second deadline. The discovery catalog limit is separate from the full-package candidate limit.

| Measure | Final result |
| --- | --- |
| Evaluated queries | 30 |
| Positive queries with all reference sources | 27 / 29 |
| Negative query | Correctly `no-evidence-found` |
| Mean query latency | 18,182.8 ms |
| Direct-evidence verdicts | 16 |
| Direct verdict missing reference sources (proxy) | 0 |

On the same 26 positive IDs completed by v11, complete source coverage increased from 21/26 to 25/26. The final version's 27/29 must not be compared directly with 21/26 without this denominator adjustment.

Remaining misses:

- `working-break-premise`: expected `isWithinWorkingHours` absent; other real working-hours implementations selected. Different implementations handle breaks differently and the query does not specify one. Final verdict remained `partial-evidence`.
- `sms-nonjson`: only one of three required reference sources retained; final verdict `partial-evidence`. A targeted run had recovered all three, but that success did not repeat in final acceptance.

Both cases have oscillated across evaluations. No expected labels were changed to improve the score. The earlier v12-confirmed result of 28/29 and the targeted SMS success are development evidence, not substitutes for the final 27/29 result.

Artifacts: [summary](summary.json), [package audit](package-audit.json), and split outputs `dev.json`, `validation.json`, `reserved.json`. Previous comparison: [v11](../jev-v11-final-2026-09-25/).

## Two fresh questions

Two questions were source-reviewed and registered before their inference, in [cases.json](../jev-v12-fresh-2026-09-25/cases.json). They were not used to tune this implementation.

- Asaas HTTP 200 with invalid JSON: reference source recovered, but verdict `partial-evidence` and Jev diagnostics `request-failed`.
- Integra ICP invalid JSON versus HTTP failure: reference source not recovered; verdict `not-assessed`, diagnostics `request-failed`.

The harness completed both rows, but model assessment did not complete cleanly. These are not two successful acceptance tests and do not establish generalization. See [raw results](../jev-v12-fresh-2026-09-25/dev.json). The available diagnostics do not establish the cause of `request-failed`; it must not automatically be attributed to the spending limit.

## Validation and limits

- Build and workspace TypeScript checks passed after the final runtime changes.
- Vitest: 391 tests in 55 files passed.
- Budget/evaluator Node tests: seven passed.
- Whitespace diff check passed.

The 30 main queries are reused regression cases, including those named validation/reserved. They are not an untouched statistical holdout. Reference-source coverage is not answer accuracy, and zero unsupported-direct proxies does not prove zero semantic false positives.

The fixes improve this regression set, but do not eliminate retrieval misses or inference variability. No claim of perfection, 29/29 final coverage, or statistically demonstrated generalization is warranted.

## Budget

Shared ledger: `../jev-v9-reviewed-2026-09-25/budget.json`.

- Conservative charge before this request: US$0.988151390568.
- Authorized cap: US$1.988151390568.
- Conservative charge after all evaluations: US$1.984672371332.
- Additional charge: **US$0.996520980764**, below the US$1 authorization.
- Remaining allowance: US$0.003479019236. No further paid calls planned.

The ledger includes uncertain reservations; these figures are conservative accounting, not a reconciled provider invoice. Spending was never reset.

## Documentation basis

- [TypeSafe state](https://docs.typesafe.ai/concepts/state): explicit, bounded judgment context.
- [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion): separate relative preference and absolute usefulness.
- [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages): focused evidence classification.
- [Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13): typed output does not guarantee semantic correctness.
