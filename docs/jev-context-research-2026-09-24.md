# Sensegrep context AutoResearch — 2026-09-24

The new loop found one useful development feature about a candidate implementing a
necessary prerequisite or supporting step. It reached complete required-symbol
coverage in 15/19 development queries, the ceiling of the frozen retrieved pools.
Local selection covered 14/19; the current Jev coverage selector covered 12/19.
On three new held-out families, learned selection covered 3/3, but the same shadow
selection policy with raw local scores also covered 3/3. This does **not** establish
that learned Jev weights should become the runtime default.

## Implemented method

Following the [official AutoResearch cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery):

1. Freeze actual retrieval candidates, source hashes, reviewed required symbols and
   disjoint development/test families. Never insert missing gold into retrieval.
2. GPT-6 Luna proposes atomic questions using grouped out-of-fold development
   packet errors. It never receives held-out test data.
3. Jev screens questions, then measures features on individual query/candidate
   states. Unknown candidates are not converted into negative training labels.
4. Fit a small logistic predictor on reviewed labels. Select questions using the
   resulting budgeted context: complete-rule coverage, symbol/helper recall, nDCG,
   and reviewed-negative fraction. Classification accuracy alone does not decide.
5. Accept an objective improvement greater than 0.002 only when it loses no
   previously complete development packet. Stop after two stagnant rounds or the
   round/request/cost cap. Three rounds ran here.
6. Freeze the model and feature measurement contracts; evaluate a separate test
   file without fitting. Export remains `deploy: false`.

The context objective is 0.55 all-required + 0.30 required recall + 0.10 helper recall
+ 0.05 nDCG - 0.05 reviewed-negative fraction. Metrics are averaged within behavior
families before averaging families. This is a declared exploratory objective, not a
calibrated estimate of agent task success. Explicit helper-role labels are sparse;
required-symbol coverage remains the more broadly supported measurement.

The shadow selector ranks candidates, excludes incomplete source and overlapping
ranges, and respects 4,000 tokens / five results. It never reads gold labels.
It permits multiple nonoverlapping symbols from one file. Comparisons use identical
retrieved pools and do not replay the complete adaptive runtime recovery cascade.

## Data and comparison

Development: 19 queries, four behavior families, 380 retrieved candidate instances,
44 explicitly reviewed labels. Test: three new families and queries, 60 candidate
instances: token-bucket refill, UTC range helpers, and order-item signatures.
Labels were agent-reviewed against source, not independently human-reviewed.
Previously examined fixtures, including the old SMS test cases, are development.

| Frozen-pool method | Development complete | Test complete | Test nDCG | Test mean context tokens |
|---|---:|---:|---:|---:|
| Local diversity + budget | 14/19 | 2/3 | 0.9013 | 1,779 |
| Current Jev coverage selector | 12/19 | 2/3 | 0.8231 | 204 |
| Shadow selector, raw local scores | 14/19 | 3/3 | 0.8770 | 1,980 |
| Shadow selector, fitted structural baseline | 11/19 | 3/3 | 0.6872 | 1,331 |
| Shadow selector, structural + learned Jev feature | **15/19** | **3/3** | 0.8661 | 1,330 |

The learned model's development objective increased from 0.5618 for its fitted
structural baseline to 0.8253. Against raw local scores with the same selector,
the increase was smaller: 0.7920 to 0.8253. The local diversity/budget objective
was 0.7864. Reporting only the weak fitted baseline would overstate improvement.

The learned model reaches all 15 development queries whose required symbols exist
in the retrieved pools. The four remaining failures lack required retrieval evidence:
encryption helpers and Brazilian SMS recipient normalization. Weights cannot fix
these missing candidates. The current selector also loses evidence through file
diversity and final selection, notably the UTC helper chain in test.

The new selector includes more material: development reviewed-negative fraction is
7.5%, versus 0% for the local diversity/budget baseline; many remaining selections
are unreviewed. Test has no explicit reviewed negatives, so its zero negative fraction
is not evidence of perfect precision. Test nDCG is slightly below raw local scores
under the same policy. Three positive tasks from one repository cannot establish
statistical significance, absence handling, generalization or agent correctness.
No runtime latency or downstream agent improvement is claimed by this replay.

## Corrections made during the run

The initial screening-only run rejected every proposed question at an uncalibrated
0.60 cutoff. It is preserved as `frozen-model.json`. The corrected development
screen rejects clear failures (<=0.25), pilots uncertain questions on a small
label-blind sample, and requires a feature range >=0.15 before full extraction.
These thresholds are experimental heuristics; grouped packet outcomes determine
acceptance. This correction was made before test evaluation.

The completed discovery is preserved as `frozen-model-v2.json`. It accepted one
question, `operation_prerequisite`, from the first round; later proposals and the
revision did not meet the incremental acceptance gate.

A test protocol defect was then caught before reading test metrics: extracting only
the accepted question removed a rejected companion question that had been present
during training measurements. Question batches are part of the measurement contract.
The invalid attempt is preserved as `heldout-invalid-question-contract.json` with
`invalid-test-note.json`. The exact ordered batches were reconstructed solely from
development history into `frozen-model-v3.json`; weights and accepted questions did
not change. `heldout.json` is the valid evaluation, whose contract hash matches
training. No test results were used for fitting or question selection. This was one
invalid attempt followed by one valid evaluation, not an uninterrupted single run.

Jev input truncation was recorded for two distinct development candidates (six
observations across rounds) and two test candidates. None appeared in the learned
selected packets. Full source availability and Jev input truncation are distinct;
the reports preserve this limitation rather than treating partial model input as
full evidence.

## Cost and validation

Provider-reported discovery cost: $0.044293 over 1,162 requests; valid test:
$0.002635 over 60 requests. Dataset baseline evaluation: $0.032379; initial screening
pilot: $0.001671; invalid test attempt: $0.002439. Total approximately **$0.08342**.
These are provider usage costs, not inferred from generated token counts. Models:
`openai/gpt-6-luna` and observed `typesafe/jev-1.13-20260917`.

Validation: 10 new context-research tests, eight existing Python research/calibration
tests, and five Node evaluation tests passed. Both JavaScript scripts pass syntax
checks; `git diff --check` passes. Tests cover grouped isolation, unknown labels,
budget/overlap, absent gold, accepted improvements, uncertain and constant pilots,
frozen snapshots/schema, and exact companion-question replay. Artifact hashes and
unchanged model weights were also verified.

## Decision and next work

The requested outcome-based AutoResearch is implemented and exercised with real
Jev calls. Learned weights and deeper expansion remain unpromoted. The next useful
experiment should improve retrieval of the four missing development cases, while
preserving the required-symbol coverage already achieved. Then collect additional
independently reviewed families/repositories, including no-answer queries, and run
a new frozen holdout plus downstream agent/latency comparisons. The three test
families used here are now consumed and must not serve as untouched tests again.

Commands and contracts: [Jev documentation](jev.md#autoresearch-on-budgeted-context-outcomes).
Evidence: [frozen model](evaluations/jev-context-research-2026-09-24/frozen-model-v3.json)
and [valid held-out report](evaluations/jev-context-research-2026-09-24/heldout.json).
Source-bearing datasets remain private in ignored `.jev-local/`.
