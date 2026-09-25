# Retrieval and context AutoResearch — 2026-09-24

The final development result is **18/19 complete required-symbol packets**, up from
15/19 in the previous experiment. All 15 previously complete episodes remain
complete. Retrieval now contains all required symbols for 19/19 episodes, within
the same 20-candidate pool. Context selection still uses five results / 4,000 tokens.

The frozen model completes 4/6 new held-out queries across three families. The same
dependency-aware selector with raw local scores also completes 4/6. Learned Jev
weights are therefore still experimental; this sample does not justify promotion.

## Root cause and runtime fixes

`dedupeOverlapping` grouped rows by file to detect overlaps and then flattened those
groups. That destroyed the incoming global relevance order. Low-ranking siblings
from an early file consumed slots before stronger symbols in other files. The
function now retains the original ordering of surviving rows.

The four original failed queries had their gold at ranks 21–54 in larger diagnostic
searches. With correct ordering, encryption implementation/key helpers and Brazilian
SMS normalization reach the top 20. A previously covered constant then fell outside
the limit: a real development regression, not accepted as the price of a higher total.

Search now preserves bounded constant dependencies of leading implementations:
five anchors, at most two promotions, only candidates already retrieved within scope,
exact source coordinates and symbol identity, and AST/freshness verification.
Constant evidence can include inert arithmetic such as `30 * Time.DAY`; expressions
are returned as source, never executed. Calls, environment reads and shadowed
bindings do not become constant evidence. Failure retains the original ranking.
Telemetry records analysis time and the number promoted. No deeper traversal or
extra remote inference is enabled by these fixes.

| Query | Before: first relevant gold positions in larger search | Corrected 20-candidate pool |
|---|---|---|
| Payout encryption, PT | encrypt 22; key helper 24 | encrypt 7; key helper 11 |
| Encryption-key validation, PT | key helper 54 | key helper 20 |
| International phone rejection, EN | SMS helper 24 | SMS helper 11 |
| International phone rejection, PT | SMS helper 21 | SMS helper 6 |

The complementary old-balance constant is retained at position 6 in the Portuguese
query, while its implementation is at position 4. These are candidate ranks, not a
claim that every helper already appears in the default CLI's first five results.

## AutoResearch changes

The loop follows the [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery):
Luna proposes narrow questions, Jev measures features, a predictor is fitted, and
grouped development errors drive subsequent proposals. Packet completeness decides
acceptance. Test data does not reach the proposer.

New controls prevent misleading improvements:

- Reuse prior development discoveries with their exact ordered question batches,
  remeasure on the new pool, and revalidate under grouped CV.
- Compare learned/local blends with weights 0, 0.25, 0.5, 0.75 and 1, using development
  only. This avoids comparing solely against an overfit structural classifier.
- Enrich frozen pools with verified same-file AST call edges. The shadow selector
  may preserve up to two small direct callees of a selected small implementation
  (512 tokens each), replacing an unprotected tail under the original budget. It
  never reads gold labels or inserts absent candidates.
- `--preserve-artifact` checks the previous complete development episodes and records
  a preservation gate. A failed gate blocks the separate held-out command before
  feature requests. The final gate passes with no lost episodes.
- Checkpoint completed dataset episodes, fingerprint the manifest/snapshot/binary,
  preserve partial failures, and reuse exact-contract cached evaluations. Incomplete
  remote responses are not silently accepted as valid feature labels.

Three features remain: `operation_prerequisite`, `operative_rule`, and
`operative_parameter`. The final learned/local blend is 25% predictor / 75% local
score. These are ranking utilities, not calibrated correctness probabilities.

## Results and attribution

Development: 19 queries / four families, 380 retrieved instances, 32 reviewed labels
in the final pool. Unknown candidates stay unknown. Repeated PT/EN paraphrases stay
in the same CV fold. New test: six queries / three families (working hours, consent
validation, indexed patient lookup). All labels are agent source-reviewed, not
independently human-reviewed.

| Frozen-pool selection | Development complete | New test complete | Test nDCG | Test mean tokens |
|---|---:|---:|---:|---:|
| Local diversity/budget | 14/19 | 3/6 | 0.6563 | 1,934 |
| Current Jev coverage replay | 14/19 | 1/6 | 0.4986 | 266 |
| Dependency-aware shadow, local scores | 15/19 | 4/6 | 0.6499 | 1,664 |
| Dependency-aware fitted structural baseline | 15/19 | 3/6 | 0.5546 | 1,437 |
| Dependency-aware learned Jev model | **18/19** | **4/6** | 0.5720 | 2,310 |

The learned model's group-weighted development objective is 0.9550 versus 0.8279
for the same selector with local scores. Its reviewed-negative fraction is 5.58%;
most other selected candidates are unreviewed, so perfect precision is not claimed.
The remaining development miss is the English international-phone query's
`normalizeBrazilianSmsRecipient` helper.

Both held-out working-hours queries lack `parseTimeToMinutes` in their retrieved
pools. The Portuguese learned packet additionally drops other required symbols.
The learned model ties local-only structural selection on held-out completeness,
has worse held-out nDCG, and uses more tokens. Coverage improvement in new families
cannot be attributed exclusively to Jev. The fixed-pool replay is not the complete
runtime cascade or a downstream agent-success benchmark.

## Experiment integrity

`model.json` records the ordering-only investigation: the refitted pointwise model
did not provide a satisfactory development result. `final-model.json` reached 17/19
after constant preservation and score blending, but lost one previously complete
episode. It was not promoted. Its test extraction had already been initiated;
`heldout-unpromoted-unread.json` is retained, but its quality metrics were not read
or used to tune the subsequent candidate. This procedural mistake motivated the
explicit pre-test preservation gate; it is not presented as an untouched single
attempt from start to finish.

`preserved-model.json` is the final frozen artifact. `preserved-heldout.json` is its
evaluation after the preservation gate passed. No model/selection changes were made
after reading that report. Earlier dataset builds also encountered incomplete Jev
responses; their logs were retained and later builds resumed from validated
checkpoints. The old three-family test from the prior experiment was not reused as
a new holdout.

Evidence: [final model](evaluations/jev-retrieval-research-2026-09-24/preserved-model.json),
[held-out evaluation](evaluations/jev-retrieval-research-2026-09-24/preserved-heldout.json),
and [actual CLI stage comparison](evaluations/jev-retrieval-research-2026-09-24/final-stages.json).
Source-bearing datasets and checkpoints remain in ignored `.jev-local/`.

## Actual CLI ablation and validation

The stable-build CLI comparison ran 36 commands: four original failure queries,
six new held-out queries and two known out-of-domain questions, across local,
ordinary Jev recovery, and depth-three recovery. These are actual runtime symbol
presence measurements, separate from the learned shadow selector above.

| Runtime arm | Four original failures: all gold present | Six new queries: all gold present | Negative weak-evidence signals | Median wall time |
|---|---:|---:|---:|---:|
| Local | 1/4 | 3/6 | 2/2 | 3.058 s |
| Jev, ordinary recovery | 2/4 | 1/6 | 2/2 | 5.051 s |
| Jev, depth-three recovery | 2/4 | 1/6 | 2/2 | 5.069 s |

All remote initial evaluations reported complete. A complete remote evaluation does
not imply complete evidence or a successful answer. Deeper recovery did not improve
coverage in this run; its small median difference from ordinary recovery is not
evidence of a meaningful latency effect. Jev's new-family regression remains a
reason not to promote the experimental configuration. The negative probes were
Cassandra hinted handoff/quorum repair and Vulkan shader/command-buffer handling;
their distinctive terms were absent from the frozen app/backend/package source.
Weak evidence does not prove repository-wide absence.

Final discovery provider usage: $0.085834 / 1,529 fresh requests. Final held-out
feature extraction: $0.008108 / 120 fresh requests, with other exact-contract
measurements reused from cache. Runtime ablation: $0.078187. These are not the total
bill for the turn: earlier development runs, dataset generation, retries and the
quarantined extraction also incurred usage. Models were `openai/gpt-6-luna` and
observed `typesafe/jev-1.13-20260917`.

Validation passed: **327 Vitest tests in 52 files**, **22 Python research/calibration
tests**, **five Node evaluation tests**, `npm run check` (build and workspace type
checks), script syntax checks, and `git diff --check`. No npm publication or global
CLI installation was performed in this iteration.

## Reproduction

```sh
node scripts/build-jev-context-dataset.mjs --root <frozen-root> --manifest scripts/fixtures/jev-retrieval-research.json --output .jev-local/new-pool.json
node scripts/enrich-jev-context-dependencies.mjs <frozen-root> .jev-local/new-pool.json .jev-local/new-linked-pool.json
python scripts/autoresearch-jev-context.py train .jev-local/new-linked-pool-dev.json .jev-local/new-model.json --live --proposer-model openai/gpt-6-luna --seed-artifact <prior-model.json> --preserve-artifact <prior-model.json> --rounds 3 --max-cost 2 --max-requests 2600
python scripts/autoresearch-jev-context.py test .jev-local/new-linked-pool-test.json .jev-local/new-test.json --live --artifact .jev-local/new-model.json --max-cost 1
```

These test families are now consumed. Further tuning needs a newly reserved test,
more reviewed negatives, and additional repositories. Learned weights and the
dependency-aware shadow selector are not installed into runtime by these commands.
