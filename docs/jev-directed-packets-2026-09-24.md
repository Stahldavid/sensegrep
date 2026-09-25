# Directed evidence packets: implementation and validation

## Scope

Changes live in the Sensegrep working tree. No npm publication, global upgrade,
Luna call, proposer call or learned-weight promotion was performed. Live semantic
retrieval uses the existing frozen CuraAI index and Jev decisions use OpenRouter.

## Implemented decisions

1. The default staged panel asks about topic relevance, concrete evidence,
   contradiction and literal query aspects. The larger composite panel remains
   an explicit ablation. Eligibility buckets preserve local order within a bucket
   instead of replacing it with another uncalibrated weighted score. The first
   eligible packet anchor also preserves that order; aspect coverage cannot
   replace it with a high-scoring supporting helper.
2. Directed caller/callee evidence replaces symmetric dependency links. Callers
   pack necessary helpers before independent competitors. Necessity is judged
   against the actual supplied caller relation; unrelated anchors are omitted.
   Source-verified referenced constants do not need to be standalone answers.
3. Packet assessment runs on the selected source under the requested budget.
   Incomplete or unassessed packets can trigger one bounded recovery cycle.
   Graph traversal follows verified edges, enforces depth/candidate/time limits,
   and never asks the model to invent function names.
4. A conditional contribution check can restore an independent implementation
   discarded by maximum-aspect coverage. It appends at most one candidate without
   removing its conditioning context. Concrete answer evidence is sufficient to
   enter this check even when the independent topic judgment disagrees.
5. Initial judging cannot consume the reserved final-verification budget. Changed
   packets invalidate old verdicts. Provider failures retain local order; partial
   validated decisions do not fabricate scores for unassessed candidates.
6. Diagnostics record selection exclusions, before/after packet verification,
   conditional contribution decisions and stage time allocations.

## Evaluation contract

The 12-case manifest has ten positive cases and two negative cases. It includes
Portuguese/English queries, 4,000-token contexts and one 1,200-token stress case.
The same snapshot, compiled build and fixture hash are recorded in each final
report. Query embeddings may be cached; Jev decision caching is disabled.
Arms alternate order. No source code or credentials are saved in these reports.

Three measurements remain separate: exact required symbols, explicitly reviewed
alternative implementations, and source content proving listed facts. None is
a measure of downstream agent answer accuracy. The facts are finite assertions,
not proof that every possible detail of an answer is complete.

The generic key-decoding query accepts payout symmetric-key validation or CESS
public-key validation, both verified in source. The payout-specific query does
not. The consent version value may be shown by either identical declaration, but
strict linkage still requires the declaration referenced by the backend function.
After the initial run, browser URL sanitization was source-reviewed and accepted
for the generic analytics question; the original backend-only target remains in
strictCoverage. This correction is explicit and these cases are regression data,
not an untouched holdout.

`status: incomplete` can indicate that retrieval omitted other candidates; it is
not the same as a missing required helper. `budget.usedTokens` includes serialized
JSON diagnostics. The report's `estimatedContextTokens` uses the source selection
metric instead, so it can be checked against the requested 1,200/4,000 budget.
The initial report predates this reporting correction.

## Sources

- [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion): relative
  ranking and absolute eligibility serve different purposes.
- [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages):
  narrow evidence judgments with explicit application routing.
- [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13): focused
  context and deterministic enforcement of structural constraints.

## Reproduction

Build once with `npm run check`, then keep the compiled artifacts unchanged:

```powershell
node scripts/evaluate-jev-stages.mjs --root <frozen-snapshot> --cases scripts/fixtures/jev-directed-packets.json --output <report.json> --arms local,all --timeout 8000 --max-cost 2
```

Repeat with `--timeout 15000` in a separate report. Run
`node scripts/summarize-jev-directed.mjs <8s-report> <15s-report>` for the paired
summary. A larger deadline is not automatically a better decision policy.

## Validation results

Earlier runs exposed a concrete analytics regression: max-aspect selection chose
`getAnalyticsHashSalt` before the first eligible implementation,
`hashAnalyticsIdentifier`. The conditional contribution score alone remained
below its admission threshold. We preserved eligibility/local anchor order in
selection instead of changing that threshold to fit the case. A dedicated test
covers a lower-aspect caller and a higher-aspect helper. Earlier build reports
are retained separately; only the final matching-build reports support the final
comparison below.


### Final validation (2026-09-25 local time)

- `npm run check`: build and all workspace type checks passed.
- `npx vitest run`: 53 files, **344 tests passed**.
- Node evaluation tests: **6 passed**.
- `npm run version:check`: consistent at 1.18.0; version was not bumped.
- `git diff --check`: passed.
- **48 final CLI executions**, same build, index snapshot and manifest hash,
  zero command failures. All source-context token estimates stayed within each
  case's 1,200/4,000-token budget. Jev cache disabled; observed model was
  `typesafe/jev-1.13-20260917`.

| Deadline / arm | Reviewed symbols | Strict original symbols | Listed facts | Correct negatives | Median CLI wall time | Jev calls | Input/output usage cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8 s / local | 3/10 | 3/10 | 3/10 | 0/2 | 3.25 s | 0 | $0.00000 |
| 8 s / Jev | 9/10 | 7/10 | 9/10 | 2/2 | 6.57 s | 282 | $0.02663 |
| 15 s / local | 3/10 | 3/10 | 3/10 | 0/2 | 3.22 s | 0 | $0.00000 |
| 15 s / Jev | 9/10 | 7/10 | 9/10 | 2/2 | 6.59 s | 276 | $0.02617 |

The larger deadline did not improve this sample; keep the existing 8-second
default. These are small, repeatedly inspected regression cases, not proof of
generalization or a statistically established downstream-agent improvement.
Compared arms use the same reviewed manifest. Do not compare 9/10 directly to
older 5/10 reports with different queries or labels.

The matched-build reports are [default 8 seconds](evaluations/jev-directed-packets-2026-09-24/default-8s.json),
[extended 15 seconds](evaluations/jev-directed-packets-2026-09-24/extended-15s.json),
and [summary](evaluations/jev-directed-packets-2026-09-24/summary.json). Earlier
reports are preserved under `initial-*` and `pre-*-fix-*`; they describe earlier
builds and must not be pooled as repeated measurements of the final build.

### Remaining quality limitation

The working-hours query selects `validateWorkingHours`, `assertWithinWorkingDay`
and related helpers in `appointmentUtils.ts`, rather than the reviewed
`isWithinWorkingHours` / `parseTimeToMinutes` implementation. Source review confirms
that the returned flow does reject disabled days and checks parsed times for
null, but its parser is absent from the final packet. The supplied source does
not prove the rubric's hour/minute bounds. We retained this as a failure instead
of broadening the accepted labels after seeing it. Jev can nevertheless label
this packet `direct-evidence`: final semantic sufficiency remains advisory.

The analytics-salt regression is fixed: the hash implementation and salt
validation are now selected together. The timezone query also includes the
source-verified fallback constant after conditional contribution; the same
bundle rule now applies to initial and later-added implementations.

Learned weights remain experimental. This work implements the planned selection,
recovery, scheduling and measurement changes; it does not claim perfect semantic
judgment, and does not promote an AutoResearch artifact based on these cases.
