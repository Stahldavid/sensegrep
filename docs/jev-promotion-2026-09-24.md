# Expanded Jev promotion evaluation — 2026-09-24

Decision: keep Jev and its experimental controls optional. Do not promote deep
recovery, three-way verification, or offline learned weights as defaults from this
sample. This decision concerns generalization and retrieval regressions, not the
price of Jev relative to a production generator.

## Retrieval experiment

100 live CLI calls on two verified snapshots, unchanged compiled build, rotated
arm order, Jev cache disabled, 4,000-token contexts. Each arm contains 21 positive
queries and four absent-topic queries. PT/EN paraphrases are correlated; these are
not 25 independent behavior families. Success requires every labeled symbol in
the top five, except the explicit context-budget case, which checks the packet.

| Mode | CuraAI positive | Sensegrep positive | Combined | Absent-topic weak evidence | Mean latency |
| --- | --- | --- | --- | --- | --- |
| Local | 13/14 | 3/7 | 16/21 | 2/4 | 2.80 s |
| Jev all stages | 14/14 | 2/7 | 16/21 | 4/4 | 4.26 s |
| All + three-way verification | 14/14 | 2/7 | 16/21 | 4/4 | 4.22 s |
| All + depth 3 | 13/14 | 2/7 | 15/21 | 4/4 | 4.35 s |

All 100 calls completed without CLI failures; an `incomplete` evidence status is
not a process failure. Reports retain these statuses rather than converting them
to successes. The all-stage arm recovered the minimum-payout rule in CuraAI but
lost `evaluateWithJev` on the Sensegrep fallback query. Depth 3 additionally lost
the labeled symbol on the CuraAI `auth-en` case. The broad score-distribution
query still missed `parseJevScores`.

Code inspection identifies a plausible contributor to the fallback-query loss:
`selectEvidenceCoverage` only admits complete candidates that fit the remaining
budget, whereas local selection can emit explicitly truncated implementation.
The Jev result contained an unassessed test chunk. This is a diagnosis hypothesis,
not a demonstrated causal fix. Regression gates should preserve useful local
evidence when the coverage packet cannot supply assessed evidence, and exercise
large implementations at multiple budgets before promotion.

## Repeated end-to-end agent experiment

Six source-understanding tasks, two repetitions, three modes: 36 executions with
`openai/gpt-6-luna`, a verified frozen CuraAI snapshot and rotated mode order.
The generator used search/read tools; source-reviewed answer keys were hidden.

| Mode | Strict answer pass | Generator input tokens | Mean latency | Searches |
| --- | --- | --- | --- | --- |
| Local | 12/12 | 149,061 | 11.56 s | 17 |
| Jev all stages | 12/12 | 107,760 | 17.54 s | 23 |
| All + three-way verification | 11/12 | 94,160 | 16.15 s | 21 |

All-stage Jev reduced generator input tokens by **27.7%**, but increased mean
latency by **51.7%**. The earlier three-task single-pass 79.3% token reduction did
not generalize to this expanded repetition. Three-way verification reduced input
by 36.8%; its strict failure returned the full `v1.<...>` serialized format where
the key expected just `v1`. This is an output-format mismatch, not evidence of a
cryptography misunderstanding or a demonstrated causal regression from Jev.
Keep the strict failure in the aggregate; do not silently relax the answer key.

Normal Jev/provider caching was available in these agent runs, unlike the stage
matrix. Results describe observed runs, not cache-controlled latency estimates.
Combined observed agent costs were $0.01081 local, $0.04169 all-stage, and $0.03858
verification. These Luna costs do not model the more expensive production model;
promotion was not rejected on cost. Sample size, task correlation, the retrieval
regression and absence of a production-model coding benchmark remain limitations.

## Frozen learned weights on a second repository

32 source-reviewed positive/negative pairs from Sensegrep, six behavior families,
12 queries, evaluated with frozen weights/questions learned on CuraAI. No fitting
or feature selection used these external labels. Observed model:
`typesafe/jev-1.13-20260917`.

| Metric (lower is better) | Frozen selected model | Raw local score |
| --- | --- | --- |
| Brier | 0.05794 | 0.17795 |
| Log loss | 0.21709 | 0.53128 |

This is promising transfer evidence, but the raw local score is **uncalibrated**,
not the fitted local baseline from the original experiment. Pair classification
does not demonstrate end-to-end retrieval gains. Labels are agent source-reviewed,
not an independent human benchmark. Keep `deploy: false`; evaluate a frozen fitted
baseline and a runtime shadow arm before integrating these weights into selection.

## Reproduction and artifacts

Expanded stage arms: `--arms local,all,verification,deep` on
`scripts/evaluate-jev-stages.mjs`, with the two `jev-matrix-*.json` fixtures.
Agent run: `scripts/evaluate-jev-agent.mjs --live --model openai/gpt-6-luna
--variants off,both,verification --repeats 2`, with
`scripts/fixtures/jev-agent-promotion.json` and a frozen CuraAI root.
External pairs: `scripts/fixtures/jev-research-external.json`, built with
`scripts/build-jev-research-dataset.mjs`, scored by
`scripts/evaluate-jev-external.py` against the v5 `research-real.json` artifact.

Source-free reports live in `evaluations/jev-promotion-2026-09-24/`. Compiled build
and snapshot identifiers are retained in the stage reports; frozen artifact and
private dataset hashes are retained in the external report. Source-bearing
datasets remain in ignored `.jev-local/`. The new external Python evaluator was
added to the indexed repository after the Sensegrep stage run finished; reindex
before reproducing against that working tree.

Validation of evaluator changes: five Node tests and eight Python tests passed.
No runtime defaults or published/global CLI versions were changed.
