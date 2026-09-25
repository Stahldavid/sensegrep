# Jev v4 — controlled panels, gap recovery and GPT-6 Luna

Date: 2026-09-24. Implementation on `works/jev-coverage`, atop the uncommitted v3 work. This is not a new npm release. Jev remains off by default; no learned or calibrated ranker is automatically activated.

## Changes

- Score/RRF no longer use Score concentration as a reliability weight. `confidence-baseline` preserves the previous formula for comparison; `useful` exposes supporting+direct probability mass, and `noul` ranks answer evidence.
- `--jev-panel noul|score|composite` isolates a single binary question, single descriptive Score, or the full atomic panel. Default remains composite with batch 5; experiments do not establish a universal winner.
- Atomic missing-helper/configuration/condition signals drive one bounded pass through real calls or AST-resolved same-file literal bindings. Source hashes and scope filters remain enforced. Recovered constants are visible evidence, not hidden context.
- Coverage selection stops redundant zero-gain tails while retaining supported linked dependencies and contradictory evidence. This avoids filling the budget merely because room remains.
- Offline isotonic calibration has exact-contract invalidation, grouped validation, provenance and raw/calibrated diagnostics. No production calibration claim is made without reviewed real labels.
- Offline AutoResearch now proposes/revises questions, measures development features, accepts/prunes with grouped CV and evaluates the frozen test once. Proposer and agent tests use GPT-6 Luna after the user's model selection; Jev remains the typed evaluator.

## Frozen candidate experiment

Five queries (three rule groups), including Portuguese/English and two absent topics, were captured from an unchanged indexed CuraAI snapshot. Each ran 3 panels × 3 batch sizes × 3 order/context variants: **135 evaluations**, costing **$0.169051428**. One composite/batch-5 evaluation was partial; it remains in the report as a failure. Cache was disabled. Source is retained only in ignored local fixtures.

All normal-order arms found the small-balance helper first in both languages. The cryptography helpers were absent from the frozen local candidate pool, so every reranking arm missed them. This is a retrieval failure, not evidence that another rank formula would fix it.

| Panel | Batch | Median judge stage | Positive cases with all required symbols in top 5 |
|---|---:|---:|---:|
| Noul | 1 | 1,706 ms | 2/3 |
| Noul | 5 | 433 ms | 2/3 |
| Score | 1 | 1,710 ms | 2/3 |
| Score | 5 | 384 ms | 2/3 |
| Composite | 1 | 1,759 ms | 2/3 |
| Composite | 5 | 465 ms | 2/3 |

Reversing batch order changed some scores substantially: maximum observed evidence drift was 0.35 for Score/batch-5 and 0.38 for composite/batch-5, versus 0.11 and 0.08 for their singleton counterparts. Even singleton calls varied slightly between repeated requests, so drift is not all attributable to order. Batch 1 improved observed stability but incurred more latency; this sample does not justify forcing it universally.

Artifacts: [full source-free observations](evaluations/jev-v4-2026-09-24/frozen.json), [summary](evaluations/jev-v4-2026-09-24/frozen-summary.json). These are 5 queries, not 135 independent quality examples.

## Complete CLI, including helper recovery

On the same 5-case regression subset:

| Arm | Cases passing the declared retrieval/negative check |
|---|---:|
| Published local | 3/5 |
| New local | 3/5 |
| Published Jev | 4/5 |
| New Jev | 5/5 |

The new path included both encryption/decryption helpers in the top 5. Unlike the frozen returned-pool experiment, this exercises the actual Jev helper candidate pool and final selection. Neither negative query received a direct-evidence verdict. The paired group-bootstrap intervals include zero: no generalized significance claim. Background development/evaluation activity means timing should not be interpreted as an isolated performance benchmark.

[Source-free matrix](evaluations/jev-v4-2026-09-24/matrix.json).

## Read-only agent with GPT-6 Luna

Three tasks required actual source-derived answers: payout encryption parameters, the exact small-balance age boundary, and encryption-key validation. Hidden deterministic answer fields were checked without a Jev judge. Each arm ran once per task.

| Aggregate across 3 tasks | Local context | Jev context |
|---|---:|---:|
| Correct answers | 3/3 | 3/3 |
| Luna input tokens | 36,610 | 22,490 |
| Luna output tokens | 550 | 701 |
| Searches | 4 | 7 |
| Explicit file reads | 3 | 3 |
| Total observed time | 35.293 s | 52.416 s |
| Combined provider cost | $0.002811 | $0.012159 |

Jev reduced generator input by **38.57% in this run**, but increased search count and latency. Jev input tokens are not included in the Luna token column; Jev cost is included in combined cost. Luna was selected to keep evaluation cheap; the user clarified that production uses a stronger, more expensive model. Therefore the Luna cost comparison is not the production economic decision. This is not a patch-generation benchmark. [Luna observations](evaluations/jev-v4-2026-09-24/agent-luna.json).

For production economics, the observed differences are 14,120 fewer generator input tokens, 151 more generator output tokens and $0.010461318 of Jev calls. Applying hypothetical uncached production prices to that same token pattern:

| Input/output price per million tokens (hypothetical) | Net saving across these 3 tasks, after Jev |
|---|---:|
| $1 / $5 | $0.002904 |
| $2 / $10 | $0.016269 |
| $5 / $25 | $0.056364 |

If output costs five times input, the break-even input price is approximately **$0.783 per million tokens**. Formula: `(14120 × inputPrice - 151 × outputPrice) / 1e6 - 0.010461318`. These are scenarios, not current prices for named models. Cache discounts and a different production model's search/output behavior change the calculation. The observed token reduction supports the production hypothesis; quality, additional searches and latency still require validation. Jev remains optional because this small regression set does not establish generalized quality, not because its cost exceeds the deliberately cheap Luna test model.

Earlier GPT-5.4-mini runs are retained separately: [before redundant-tail fix](evaluations/jev-v4-2026-09-24/agent.json), [after fix](evaluations/jev-v4-2026-09-24/agent-final.json). They are not pooled with Luna and also do not establish universal token savings.

## AutoResearch mechanism smoke

GPT-6 Luna proposed `implements_requested_behavior`: whether executable logic performs the requested behavior rather than merely mentioning/displaying related concepts. The loop retained that question. On a deliberately simple synthetic test, Brier fell from 0.03933 to 0.00291; total recorded cost was $0.001429294 across 56 requests (proposer plus feature calls).

This synthetic dataset repeats simple implementation patterns and is **only a mechanism smoke**, not an independently labelled code benchmark. It cannot validate deployment quality. The artifact explicitly has `deploy: false` and records synthetic label provenance, model revisions and question contract hashes. [Luna discovery artifact](evaluations/jev-v4-2026-09-24/research-luna.json).

No human-reviewed domain calibration dataset was available in this task. Calibration fit/application, contract invalidation, monotonicity and split leakage were validated with synthetic tests; no calibrated runtime model was published or activated.

## Reproduction and limitations

Validation: **311 Vitest tests across 50 files**, six Python tests and four Node script tests passed. All workspace typechecks, version consistency and release artifact checks passed. Synthetic calibration tests validate machinery and contract invalidation; no human-labelled production calibration is claimed.

See [Jev usage and experiment commands](jev.md). The original matrix, discovery loop and calibration mechanics remain separate so that retrieval failures, ranking failures and answer failures are not conflated. Exact identifier bypass, local fallback, request/byte budgets and advisory evidence semantics are preserved.

Research references: [Confidence](https://docs.typesafe.ai/confidence), [Score](https://docs.typesafe.ai/primitives/score), [reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe), [model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery), [calibration reference](https://github.com/TrustifAI/typed_evals/blob/main/docs/CALIBRATION.md).
