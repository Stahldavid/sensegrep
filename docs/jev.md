# Jev evidence evaluation

Implementation results and limits: [Jev v4 evaluation](jev-v4-evaluation-2026-09-24.md), [previous v3 evaluation](jev-v3-evaluation-2026-09-24.md).

Jev supplements local retrieval through OpenRouter System One. Search/context default to **both when a dedicated Jev credential is configured** (`SENSEGREP_JEV_API_KEY` or `jev.json`). Without dedicated configuration they remain local. A generic `OPENROUTER_API_KEY` alone does not enable automatic evaluation. Active Jev transmits the query, candidate paths/symbols and source snippets to OpenRouter. Embeddings can remain local in Ollama. This behavior is in the unpublished checkout; see [the v6 evaluation](jev-v6-evaluation-2026-09-24.md).

## Configuration

Use `SENSEGREP_JEV_API_KEY`, `OPENROUTER_API_KEY`, or `{"apiKey":"YOUR_KEY"}` in the user's `~/.config/sensegrep/jev.json`, in that precedence order. Never put the key in repository files.

`--jev off` always disables remote evaluation for the command. `SENSEGREP_JEV_MODE=off`
disables automatic evaluation across commands; valid modes are off/evidence/rerank/both.
Explicit command mode wins over this environment setting. Survey and duplicate
judgements keep their explicit opt-in because they use different rubrics.

Coverage selection requires absolute usable evidence, independently of relative
ranking. Partial/unassessed source cannot close a coverage gap. If a multi-candidate
batch produces no eligible packet, or recovery hits its candidate cap without finding
an accepted helper, search can retry its shortlist with one candidate
per request, keeping questions together and respecting the same overall deadline.
Only a complete retry replaces the first evaluation. If no eligible packet fits,
the original local selection is retained. Diagnostics expose `refinement` and
`contextStatus`; this is an adaptive fallback, not a learned confidence guarantee.

```sh
sensegrep search "where are payout keys encrypted?" --jev both --json
sensegrep context "minimum payout eligibility and exceptions" --jev both --max-tokens 4000 --json
sensegrep search "payment eligibility" --jev both --jev-batch-size 5 --jev-ranking score --diagnostic --json
sensegrep search "payment eligibility" --jev rerank --jev-panel noul --jev-ranking noul --json
sensegrep survey "payment rules" --jev evidence --json
sensegrep detect-duplicates --include 'src/**' --jev evidence --jev-candidates 5 --json
```

For an unpublished checkout, use `node packages/cli/dist/main.js` after `npm run build`. The endpoint is `https://openrouter.ai/api/v1/systemone` and the model alias is `typesafe/jev-1.13`. Diagnostics include the resolved revision.

| Option | Meaning |
| --- | --- |
| `--jev off` | No remote request |
| `--jev evidence` | Evaluate final source packet, preserve local search order |
| `--jev rerank` | Evaluate/rank candidates, retain local sufficiency assessment |
| `--jev both` | Ranking, query-aspect coverage selection and final-packet evaluation |
| `--jev-candidates N` | Initial candidate/group cap, default 20, range 1–80 |
| `--jev-aspects JSON` | Explicit requirements, JSON array of 1–6 strings (240 characters each) |
| `--jev-blocks` | Experimental AST excerpts for oversized JS/TS functions; default off |
| `--jev-bundles` | Experimental same-file literal constant context; default off |
| `--jev-batch-size N` | Maximum candidates per request, default 1, range 1–10 |
| `--jev-ranking eligible` | Absolute eligibility buckets; stable local order within each bucket (default) |
| `--jev-ranking score` | Ordered relevance rubric, explicit ablation |
| `--jev-panel staged` | Relevance, answer evidence, contradiction and literal query aspects (default) |
| `--jev-panel composite` | Historical broad panel, explicit ablation |
| `--jev-panel score` | Only one relevance Score per candidate; no aspect selection |
| `--jev-panel noul` | Only one rule-specific usefulness question per candidate |
| `--jev-ranking useful` | Sum of supporting + direct relevance mass; uncalibrated |
| `--jev-ranking noul` | Order by answer evidence, without confidence weighting |
| `--jev-ranking confidence-baseline` | Previous concentration blend, only for controlled comparison |
| `--jev-ranking legacy` | Original relevance/evidence/local-score weighted formula |
| `--jev-ranking rrf` | Fuse local and model positions; ordinal, not a probability |
| `--jev-timeout MS` | Shared deadline for ranking, contribution and packet stages, default 8000 |

MCP uses `jev`, `jevCandidates`, `jevBatchSize`, `jevPanel`, `jevRanking`, `jevTimeoutMs`, `jevAspects`, `jevBlocks` and `jevBundles`. Panel/aspects/blocks/bundles apply to search/context; groups and duplicates keep their dedicated rubrics and do not reorder membership. For experiment runners, `SENSEGREP_JEV_BATCH_SIZE` and `SENSEGREP_JEV_RANKING` supply defaults; explicit options take precedence. Invalid environment defaults fall back to supported defaults. Exact identifiers, literal and graph commands do not require remote inference.

## Batches and accounting

Candidates receive stable question IDs within a batch. Each question explicitly identifies its candidate because question IDs alone are not model instructions. At most four requests run concurrently. Batches exceeding a conservative 96,000 UTF-8 byte request bound are split before sending. Provider size errors split multi-candidate batches again. This is a byte heuristic, **not an exact provider tokenizer**; singleton overflow fails locally without silently dropping required evidence.

Ordinary candidate snippets have a 24,000-character bound. Oversized symbols preserve both beginning and end and are marked truncated. Final packets are partitioned at source boundaries with a 60,000-byte target per partition and a separate 70,000-character per-partition ceiling. All partitions must be evaluated without source truncation. A singleton too large to fit remains unassessed. A direct verdict requires at least one partition to answer all requested rules; other cross-partition answers remain partial or uncertain. Query inputs over 8,000 characters fall back locally. The direct TypeSafe provider's limits must not be assumed to apply to OpenRouter.

Output tokens from Jev are free under the documented pricing. We retain useful numeric distributions rather than minimizing answer fields. Source input, question input and additional passes still cost money. Diagnostics report actual provider usage/cost; they do not estimate cost from output token counts.

The 15-minute cache hashes the **whole ordered batch**, query, requirements, rubric version and model alias. It stores only validated numeric decisions, bounded model identifiers and timestamps: no source, queries, credentials or provider legends. Rearranging or changing any candidate invalidates the whole batch. The short TTL bounds stale model-alias decisions; disable the cache for controlled comparisons using `SENSEGREP_JEV_CACHE=false`.

## Decision contracts

Search evaluates:

- `relevance`: Score levels 0 unrelated, 1 topic only, 2 supporting evidence, 3 the specific requested rule, exception or value. A helper implementing the requested exception qualifies for level 3; constants receive no blanket preference. Full distributions and confidence are retained.
- `relevant`, `evidence`, `contradiction`: separate binary judgments. A contradiction is never relabeled as support.
- `role`: implementation, helper, constant, test, wrapper or unrelated, with its distribution.
- `operation`, `condition`, `configuration`, `dependency`: separate atomic dimensions for offline analysis, not multiplied together as independent probabilities.
- `aspects`: support for explicit caller requirements or conservative literal clauses from the query. No model generates requirements.

These are **uncalibrated** judgments. A constant can be direct evidence when the query asks for a configured value. Score and RRF no longer discount evidence using distribution concentration: uncertainty between two useful levels does not establish unreliability. Diagnostics retain local score, model score, useful mass, direct mass and blend weight separately. The old blend is available only as `confidence-baseline`. Explicit exact anchors remain unchanged. RRF and legacy weights remain available for paired experiments.

With `both`, a greedy selector recomputes marginal aspect coverage against the whole selected set, combining it with stable rank, source overlap, resolved helper relationships and token fit. It stops redundant tails adding less than 0.05 average coverage, retaining supported resolved dependencies and explicit contradictions. It reuses the initial decision matrix rather than calling Jev against a fixed first-result anchor. Weights remain experimental (0.6 marginal coverage, 0.3 rank, 0.1 linked-source bonus); they are not learned or calibrated. Single-question panels have no aspect matrix and retain rank-based selection. Tiny budgets retain the explicit partial-source fallback.

`--jev-blocks` considers up to three oversized symbols. It parses one complete function, retains its header and whole guards/returns/try blocks, and asks Jev about whole optional statements. Invalid, ambiguous or single-line mixed statements fall back unchanged. Excerpts have exact line markers and are always marked incomplete; they cannot produce a fully-assessed final packet. Jev generates no code.

`--jev-bundles` adds only referenced same-file literal constants to judging context, after verifying the indexed source hash. Calls, computed expressions, ambiguous bindings and unavailable sources are excluded. This optional judging context is not silently counted as source in the final packet. Normal helper judging already includes a bounded exact caller excerpt, callsite, target and parser-resolved edge.

Context/audit retain their existing 12,000-token default. Use 4,000 for focused questions or 8,000 for broader context; 1,200 remains a stress-test budget. CLI output token limits are independent of free Jev output tokens.

## Final evidence packet

After file diversity and token selection, a separate call judges the exact structured source snippets selected for the response, including candidates that were outside the ranking shortlist. The assessment records a packet hash, result count, per-aspect strengths, supporting partition IDs and missing aspects. Direct evidence requires all aspects to meet the support threshold in a single complete packet. Support spread across partitions remains partial because their composition was not verified together.

`evidenceAssessment.verdict` is one of:

- `direct-evidence`: the model judges the requested implementation present;
- `partial-evidence`: useful evidence exists but the requested implementation is incomplete;
- `conflicting-evidence`: explicit contradiction of a query premise;
- `no-evidence-found`: the supplied packet contains little answer support;
- `not-assessed`: missing/failed/truncated evaluation or ambiguous model evidence.

Experimental routing thresholds are 0.8 for full support, 0.7 for explicit conflict or partial support, and below 0.2 for no support. Between these regions the result is uncertain. Maxima across partitions are routing signals, not joint probabilities. Thresholds require independent calibration.

All verdicts remain advisory (`calibrated: false`). `answerSufficiency` retains the backward-compatible `weak-evidence` / `not-assessed` contract; a positive model verdict is not a proof of correctness or repository-wide completeness. The assessment scope is the structured source packet, not the independently shortened human rendering.

If final serialization must reduce the response, optional per-result diagnostics are removed **before source snippets**. Removing metadata alone preserves the verdict. Removing results or cutting source invalidates it to `not-assessed` with `output-budget-changed-packet`. Very small emergency envelopes may omit the assessment altogether.

## Helper discovery and fallback

Existing local one-hop helper discovery continues to enforce file/changed-file/structural filters and caller/target source freshness. With reranking enabled, it may additionally offer direct relative-import or same-file calls without literal query overlap. Up to four shortlist positions are reserved for discovered helpers, including helpers also found by local retrieval; lexical/vector representation is preserved when the cap permits it. Extra graph-only helpers are admitted only after complete Jev evaluation with their own answer evidence.

If aspects are still unsupported or an atomic missing-helper/configuration/condition signal fires, `both` permits one additional bounded discovery pass from up to five supported anchors, offering at most four previously unseen helpers or referenced literal constants. Missing conditions select actual called helpers; missing configuration selects AST-resolved same-file literals with matching source hashes. Recovered constants become returned source candidates, not hidden judging context. It respects the remaining deadline and file/structural/min-score filters and never recursively loops. Diagnostics expose actions, missing aspects, completion status and accepted count. Existing source candidates are not replaced by graph-only matches. Discovery remains incomplete; Jev never invents graph edges.

With `--diagnostic`, `jev.trace` reports candidate identity and signals at retrieved, deduplicated, evaluated, diversified and selected stages. It contains no source code and is excluded from minimal output. Under a wire budget, the trace is removed before source snippets.

Missing credentials, malformed answers, HTTP failures or deadlines retain local order. Partial ranking batches do not partially rerank the pool. Contribution-stage failure retains deterministic selection. Packet-stage failure does not imply sufficient evidence. Caller cancellation propagates. Errors never expose provider bodies or credentials.

## Four-arm experiments and offline calibration

```sh
node scripts/evaluate-jev-matrix.mjs --root /frozen/repo --baseline /old/main.js --cases scripts/fixtures/jev-matrix-curaai.json --output /results --candidates 20
```

The matrix compares published local, new local, published Jev and new Jev, rotating run order and checking the index snapshot. Repeat with 40 and 80 candidates; the published baseline is capped at its supported maximum of 40. `--ranking rrf` changes the new Jev arm only. Results include symbol/rule proxy coverage, missing-candidate stages, false positive sufficiency on negative queries, cost, latency and a paired group bootstrap interval. Repository cases must supply independently checked expected symbols; PT/EN paraphrases of one rule belong to one group. CLI output bytes are not an end-to-end agent-token metric.

```sh
node scripts/export-jev-calibration.mjs /results /labels.json
# Independently review label and assign disjoint dev/test groups in labels.json.
python scripts/calibrate-jev.py /labels.json /calibration.json
# Optional comparison when CatBoost is installed:
python scripts/calibrate-jev.py /labels.json /calibration.json --catboost
python scripts/test-calibrate-jev.py
```

The exporter leaves every label and split unset: an unlisted symbol is not automatically irrelevant. Calibration compares local-score logistic regression with forward feature selection under grouped development CV. The held-out test set is evaluated after selection, once; optional CatBoost uses the same selected features and fixed settings. Outputs always have `deploy: false`; this tool neither activates learned ranking nor claims independent labels establish a large real-world improvement. Synthetic tests validate leakage guards and feature-selection mechanics, not Jev quality.

## Groups and duplicates

Groups preserve the local label and annotate the sampled representatives with domain and role distributions. A category with sufficient choice confidence can prefix the original title; the classification does not prove every member has the same responsibility.

Duplicate judgments separately retain shared structure, same business rule and behavioral conflict, plus five dimensions: preconditions, authorization, effects/outputs, errors/exceptions and literal/status mappings. `same-rule-candidate` requires positive agreement across all dimensions and no strong conflict; truncated or uncertain results require review. This is not semantic equivalence proof and never authorizes automatic merging. Existing AST/hash/similarity evidence is preserved. A separate JS/TS AST signature compares literal values and operator order without removing constants or status strings. Differences or unavailable parsing block the same-rule-candidate classification; an equal signature is necessary but does not prove equivalence. This guard is bounded to ten instances per group and 128,000 characters per instance.

## Reproducible evaluation

Use a frozen already-indexed repository, verify its snapshot before/after, alternate variant order, and disable Jev cache:

```sh
node scripts/evaluate-search-quality.mjs --root /path/to/frozen/repo --baseline /path/to/old/main.js --baseline-jev both --cases scripts/fixtures/search-quality-jev-curaai.json --output /path/to/results --cache reuse --jev both --jev-cache off
```

For same-build ablation, use `--baseline-ranking rrf --candidate-ranking score` or `--baseline-batch 1 --candidate-batch 5`. The CuraAI fixture measures files, symbols, context inclusion, negatives, wire budgets, latency, requests and cost. It is a regression set, not an independent generalization benchmark.

A separate synthetic decision suite checks Portuguese/English, negative queries near the domain, ordered constants, batch sizes 1/5/10 and reversed candidate order:

```sh
node scripts/evaluate-jev-decisions.mjs --live --output /path/to/decision-results
```

Both commands make paid calls when Jev is enabled. The synthetic suite tests inference/ranking in isolation, not embeddings or repository retrieval.

References: [Score](https://docs.typesafe.ai/primitives/score), [parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions), [RAG passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), [OpenRouter model](https://openrouter.ai/typesafe/jev-1.13).

## Frozen-pool panel and batch experiments (v4)

Capture once from a fresh, indexed frozen checkout. The source fixture belongs in ignored `.jev-local/`, not in a public report. Capture checks index identity before/after and preserves exactly the returned local candidate pool. It does not add expected symbols from answer keys. Therefore it can diagnose missing recall but cannot measure helper recovery; use the four-arm CLI matrix for that.

```sh
node scripts/evaluate-jev-frozen.mjs capture --root /frozen/repo --cases scripts/fixtures/jev-matrix-curaai.json --output .jev-local/frozen.json --candidates 20
node scripts/evaluate-jev-frozen.mjs run --live --input .jev-local/frozen.json --output .jev-local/ablation.json --max-cost 2
node scripts/summarize-jev-frozen.mjs .jev-local/ablation.json .jev-local/summary.json
```

Each query runs Noul/Score/composite × batch 1/5/10 × normal/reversed/distractor. Fusion strategies reuse identical model decisions in canonical local order so reversing a judge batch does not accidentally reverse the local RRF reference. Cache is disabled. Partial evaluations stay failures in the denominator. `--resume` skips already recorded arms, including failures, and rejects a different fixture hash. Repeated arms are not independent queries. Report pool recall, symbol top-5, per-candidate score drift, failure rate, observed model, latency and input cost separately. Cost ceilings are checked between evaluations; an in-flight bounded evaluation can exceed the remaining amount.

## Exact-contract probability calibration

`scripts/jev_calibration.py` implements isotonic regression with equal-score aggregation and monotone knots. It requires train/validation group isolation, both classes, label provenance, and matching contracts. Defaults require 100 training rows and 20 validation rows; these are safeguards, not statistical guarantees. It reports raw/calibrated Brier, log loss, ECE and reliability bins. A worse validation result is retained, not silently called an improvement.

```sh
python scripts/jev_calibration.py reviewed-labels.json judging-contract.json calibration.json
```

Rows contain `group`, `split` (`train` or `validation`), `label`, `labelSource`, `score` (0–1) and `contractHash`. Contracts contain `modelRequested`, `modelObserved`, complete ordered `questions`, `evidenceFields`, `panel`, `batchSize`, `version`, and `languagePolicy`. Use `contract_hash()` to fingerprint them. `apply_artifact()` validates exact identity and knots before applying; changed model, wording, state fields, order or panel requires refitting. Do not transfer thresholds between Noul, Score and Choice. No calibrated model is installed into search automatically; runtime verdicts still say `calibrated: false`.

## Offline question discovery

The v5 loop screens proposed questions using four Nouls (answerable from supplied source, atomic under its criteria, applicable, variable). Screening sees bounded development examples only, never labels or test rows. A failed/malformed screen aborts rather than being mistaken for approval; values below 0.6 reject the proposal. This is an exploratory screening threshold, not calibrated correctness. A local linter rejects explicit counting/arithmetic requests and warns about double negation, broad quantifiers, compound judgments and ambiguous references. Warnings alone do not reject legitimate conditional rules.

Proposer examples now mix the largest and smallest **out-of-fold** development errors, using only accepted features. Correlation diagnostics use absolute Pearson correlation >=0.98; redundant questions can be removed if grouped CV worsens by at most 0.0001 Brier. Correlation alone does not remove a feature with demonstrated incremental value. Final frozen ablations compare local score, local+structural, local+Jev and all features. They share one held-out evaluation stage and must not be used to select another round.

Build the small real-source research fixture with:

```sh
node scripts/build-jev-research-dataset.mjs --root /frozen/curaai --output .jev-local/research-real.json
```

Its labels are explicitly **agent source reviewed**, not independently human reviewed. Known positive and negative symbol pairs come from `scripts/fixtures/jev-research-reviewed.json`; unknown retrieval candidates are not automatically labelled negative. Curated pairs can contain symbols missing from local retrieval and therefore must not be reported as retrieval recall. The dataset records source hashes, snapshot, local retrieval score and structural features, with all paraphrases of a family in one split. Source-bearing files belong in ignored `.jev-local/` only. This small single-repository fixture is suitable for mechanism/regression checks, not promotion of learned weights.

`scripts/autoresearch-jev.py` goes beyond selecting pre-existing columns: a configurable generative model proposes or revises atomic questions, Jev scores development source, grouped CV accepts useful changes and removes redundant questions, and the loop stops on a plateau or round/request/cost budget. Noul produces one column; Score produces normalized mean/spread. The final test partition is featurized only after selection is frozen. Test labels/source never reach the proposer. The baseline includes local score plus supplied finite structural features. No prompt or source is logged by the transport.

```sh
python scripts/autoresearch-jev.py .jev-local/reviewed-rows.json .jev-local/discovery.json --live --proposer-model openai/gpt-6-luna --rounds 3 --max-cost 1 --max-requests 1000
```

Rows contain `group`, `split` (`dev` or `test`), independently reviewed `label`, `labelSource`, `query`, a `candidate` with exact source/location/metadata, and numeric `features` including `localScore`. At least three development groups and a disjoint test group are required. Keep paraphrases and duplicate implementations together. For deterministic proposal replay, replace `--proposer-model` with `--proposals proposals.json` (a list of question dictionaries); feature calls still require `--live`. The proposer uses OpenRouter Chat Completions; Jev uses System One. Both reuse configured credentials and report model identities/cost. Artifacts remain `deploy: false`; synthetic smoke labels test plumbing, not real-world generalization. Reviewed labels and independent validation are still required before activating a learned ranking model.

## AutoResearch on budgeted context outcomes

`scripts/autoresearch-jev-context.py` selects questions by the quality of a **selected
packet**, rather than candidate classification alone. Its grouped development
objective combines complete required-rule coverage, required-symbol recall, helper
recall, nDCG and explicitly reviewed negatives. Unknown candidates remain unknown.
The pointwise logistic model is only the predictor; feature acceptance uses packet
outcomes under a fixed 4,000-token / five-result budget. A candidate feature must
improve the objective without losing any previously complete development packet.

```sh
node scripts/build-jev-context-dataset.mjs --root /frozen/curaai --manifest scripts/fixtures/jev-context-research.json --output .jev-local/context-research.json
python scripts/autoresearch-jev-context.py train .jev-local/context-research-dev.json .jev-local/context-model.json --live --proposer-model openai/gpt-6-luna --rounds 3 --max-cost 2 --max-requests 2000
python scripts/autoresearch-jev-context.py test .jev-local/context-research-test.json .jev-local/context-test.json --live --artifact .jev-local/context-model.json --max-cost 1
python scripts/test-jev-context-research.py
```

Training requires a development-only file. Test is a separate command loading the
frozen model, with no fitting and no proposer; disjoint behavior groups are checked.
The snapshot, structural feature schema and exact ordered Jev question batches must
match. Even a rejected companion question is replayed when it was present during
measurement of an accepted feature; only accepted columns reach the predictor.
Output files cannot be overwritten. Preserve the test report and use genuinely new
holdouts for subsequent tuning. Hashes identify datasets, models, states and Jev
contracts. Source-bearing datasets stay in ignored `.jev-local/`.

Unlike the older classification loop, uncertain screening scores do not immediately
discard a question. Clear failures (any screening score <=0.25) are rejected; scores
between 0.25 and 0.60 get a small label-blind development pilot, requiring a feature
range of at least 0.15 before full extraction. These are declared experimental
heuristics, not calibrated probabilities or proof of feature value. Final acceptance
still requires grouped context improvement. Each feature request evaluates one
candidate, with up to four concurrent requests and shared questions per state.

The builder freezes actual retrieved pools: missing gold symbols are **never**
inserted. It records retrieval, evaluation, diversity and selection failures. Fixed
pool comparisons include local diversity/budget, current Jev coverage, the same
shadow selector using raw local scores, a fitted structural baseline, and the learned
Jev model. They do not reproduce adaptive recovery or the complete runtime cascade.
The shadow selector enforces full source, nonoverlapping ranges and token limits.
It does not read labels or required symbols. All artifacts remain `deploy: false`;
learned weights and deeper runtime expansion are not activated by this experiment.

The real run, screening correction, measurement-contract repair, comparisons and
limitations are recorded in [the context AutoResearch report](jev-context-research-2026-09-24.md).

To continue after changing retrieval, use a new dataset/output and optionally pass
`--seed-artifact <previous-frozen-model.json>` to `train`. Accepted development
questions are remeasured with their original companion questions and revalidated
under grouped CV; old weights are recorded as a control, not silently reused.
Previous development groups must remain development. Previously consumed holdouts
must not be advertised as new tests.

Context discovery also compares fixed blends of local score and the learned
predictor (learned weights 0, 0.25, 0.5, 0.75, 1). The blend is selected using grouped
development packet outcomes and frozen into the artifact; exact ties prefer less
model influence. Adding a question must preserve previously covered development
packets. These are ranking utilities, not calibrated confidence probabilities.
`seedControl` applies previously fitted weights to development and is an in-sample
diagnostic; do not compare it as independent evidence against out-of-fold CV.

For the dependency-aware shadow policy, first run
`node scripts/enrich-jev-context-dependencies.mjs <frozen-root> <dataset.json> <new-dataset.json>`.
This adds verified same-file AST call edges between existing retrieved candidates,
without using labels or inserting source. Selected implementations of at most 512
tokens can retain at most two small direct callees under the unchanged packet
budget, replacing an unprotected tail result. The policy version and dependency
contract are frozen with the model.

Use `--preserve-artifact <previous-model.json>` during training to require retention
of previously complete development episodes. The resulting preservation gate
records lost IDs and the reference hash. A failed gate blocks the separate test
command before it makes any feature calls. Do not use a test report to pick the next
candidate model.

The dataset builder checkpoints completed episodes in an adjacent private JSON file.
Resuming requires the same manifest, source/index snapshot and binary fingerprint;
incomplete remote evaluations do not become labelled training examples. Completed
frozen datasets cannot be overwritten. Retrieval wall time is recorded separately
from remote evaluation. Holdout progress logs omit candidate/label counts.

The continuation's ordering fix, dependency preservation, 18/19 development result,
new held-out results and runtime ablation are documented in
[the retrieval AutoResearch report](jev-retrieval-research-2026-09-24.md).

## Independent runtime stages and evidence categories (v5)

`--jev both` remains compatible. For explicit ablations, use `--jev-stages rerank,evidence,recovery` or a nonempty subset. Rerank changes ordering; evidence selects complementary context and assesses the final packet; recovery performs additional gap-triggered structural lookups. Initial retrieval already includes bounded helper candidates, so “recovery off” does not disable every structural feature. Exact queries still bypass Jev. Stage flags never enable remote work when Jev is off.

Every assessed result exposes an advisory `evidenceCategory`: `direct`, `supporting`, `configuration`, `test`, `contradicting`, `weak`, or `unassessed`. Contradiction takes precedence over relevance; weak and unassessed results are not deleted by the router. These categories reuse the existing role and atomic signals. They are not calibrated truth labels. Truncated snippets become unassessed, including when the final byte budget cuts their content.

`--jev-verify-aspects` changes final-packet aspect checks to a three-way Choice: supports, contradicts, says_nothing. It uses literal query requirements, never generated propositions. A negative answer to an open question can be support; only an explicitly asserted premise can be contradicted. Distributions and partitions remain available. Missing source does not establish absence; support spread across partitions remains partial.

`--jev-recovery-depth 3 --jev-beam-width 3` enables experimental multi-hop recovery (both bounded 1–3, depth defaults to 1). It follows only resolved source-checked call edges, prevents cycles, allows already-retrieved intermediates, retains multiple plausible paths and evaluates at most 12 candidates (8 at depth 1). Exploration scores are heuristics, not products of independent probabilities. Failures retain original candidates; no generated symbol names or external package traversal. Existing source/filter/freshness restrictions apply. The shared stage deadline includes graph exploration.

```sh
node scripts/evaluate-jev-stages.mjs --root /frozen/repo --cases scripts/fixtures/jev-matrix-curaai.json --output .jev-local/stages.json --max-cost 2
```

This runs the eight stage combinations plus all stages with depth 3 and three-way verification, rotating order. Reports retain failures, required-symbol recall, all-required, MRR/nDCG, false sufficiency signals, requests, cost and context size. **Do not rebuild the CLI while an evaluation runs**. Snapshot verification catches source/index drift; a build changes the tested binary independently. Keep any interrupted run as invalid evidence and rerun against a stable build. Budget limits are checked between requests/runs and can be exceeded by an in-flight bounded call.

Design references: [AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery), [RAG routing](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), [citation verification](https://docs.typesafe.ai/cookbooks/citation_check), [hierarchical beam](https://docs.typesafe.ai/cookbooks/hierarchical_classification), [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13). These motivate experiments; their reported gains are not Sensegrep results.

## End-to-end agent commands

```sh
node scripts/evaluate-jev-agent.mjs --live --model openai/gpt-6-luna --root /frozen/repo --cases scripts/fixtures/jev-agent-curaai.json --output .jev-local/agent.json --max-cost 1
```

The same agent receives local versus Jev-backed context, with alternating arm order, up to six read-only tool calls, bounded source reads and a fixed snapshot. Hidden source-reviewed JSON answer keys determine success; Jev does not grade its own answers. Reports retain correctness, generator input/output tokens, searches, reads, distinct files seen/read, total latency and combined cost. `filesSeen` includes search results; `filesRead` counts explicit reads. Source, prompts and credentials are omitted. The fixture tests repository understanding, not patch generation or general agent performance. A single run per case cannot establish a population-level speed or token gain.

Offline validation:

```sh
python scripts/test-calibrate-jev.py
python scripts/test-jev-research.py
node --test scripts/evaluate-jev-matrix.test.mjs scripts/evaluate-jev-frozen.test.mjs
```

## Promotion evaluation

Use `--arms local,all,verification,deep` with `evaluate-jev-stages.mjs` to isolate
three-way verification from deeper recovery. Use `--variants off,both,verification
--repeats 2` with `evaluate-jev-agent.mjs` to repeat the expanded six-task fixture
`scripts/fixtures/jev-agent-promotion.json`. The default evaluator behavior is unchanged.

`scripts/fixtures/jev-research-external.json` defines source-reviewed pairs from
Sensegrep for testing weights learned on CuraAI without retraining. Build its
private rows with `build-jev-research-dataset.mjs`, then run
`python scripts/evaluate-jev-external.py <rows.json> <frozen-research.json> <report.json>`.
Source stays in the private dataset; the report contains aggregate metrics only.
Its raw local-score comparison is uncalibrated and must not be presented as a
comparison against the original fitted baseline.

The expanded promotion decision and limitations are recorded in
[the promotion evaluation](jev-promotion-2026-09-24.md). Experimental flags and
offline learned weights remain optional until runtime benefits generalize without
the observed symbol-coverage regressions.


## Context repair and contextual research (2026-09-24)

Candidate evaluation now defaults to one candidate per state, with concurrent
requests and multiple questions about the same source. Explicit batch sizes still
work. One-hop structural discovery precedes semantic admission: a weak wrapper
cannot prevent lookup of its resolved callees. Caller source is bounded to 4,000
characters, with an explicit truncation flag. Existing candidates retain their
source/ranking when a verified relation is attached.

Context selection preserves uncertain linked dependencies without treating them
as proof. A nonempty packet can be repaired from bounded local anchors and their
complements under the original result/token limits. Explicit diversity limits are
reapplied. Per-aspect support describes contribution only; packet completeness is
asked separately and is still a model judgment, not a correctness guarantee.

AutoResearch accepts `--contextual` to measure each candidate against a frozen
local packet excluding that candidate (up to three complete short symbols).
`--encoding distribution` retains every Score level instead of mean/spread.
Both settings are frozen in the artifact, and seeds with different settings are
rejected. No required-symbol labels enter the feature state. Full source that
cannot be measured is rejected instead of silently supplying truncated training
examples. The current learned selector remains offline and is not loaded by CLI.

The 19/19 development result uses a source-size-filtered pool and is not directly
comparable to the prior 18/19. The two-query reserved privacy family ties the local
control at 1/2. Neither the learned weights nor deep traversal are promoted.
See [context repair evaluation](jev-context-repair-2026-09-24.md).

The direct engineering follow-up removes the second semantic admission pass after packet repair and orders bounded recovery by caller priority instead of storage order. It uses no Luna proposer or agent calls. See the direct-review section of the evaluation report.

For the current workflow, use `--proposals scripts/fixtures/jev-manual-features.json --contextual` instead of `--proposer-model`. Questions are authored and reviewed directly; only Jev measures them. Historical Luna experiments above remain documented for provenance.


## Directed packets (current implementation)

This supersedes the historical context-repair recipe above. Runtime no longer
reinserts local anchors through `repairEvidencePacket`. It selects an eligible
anchor together with directed, necessary dependencies. A resolved call proves
use, not necessity: a separate caller-conditioned Noul evaluates that question.
Source-verified referenced literals can accompany their selected parent without
passing an independent answer-relevance gate. They never count alone as proof
of answer completeness. Reverse calls are not treated as dependencies.

A preliminary verification examines the actual token-bounded packet. An
incomplete packet triggers one bounded recovery cycle. A conditional contribution
check can append one independently useful implementation omitted by max-aspect
coverage, without removing the context against which that contribution was judged.
A changed packet invalidates its old verdict and requires fresh verification.

The 8-second default reserves 1.5 seconds for final verification and 2.4 seconds
for recovery; initial judging gets at most 4.1 seconds. Early completion can fund
a preliminary check. The timeout is additional Jev pipeline time, not total CLI
wall time. Valid partial decisions retain local order; failed candidates receive
no fabricated score. No verification means `not-assessed`.

Diagnostic output exposes `selection` reasons, `packetRepair` and `timeBudget`.
Selection reasons cover assessed/final candidates; the existing stage trace
identifies candidates never evaluated. Normal compact output omits this detailed
selection list. `budget.usedTokens` measures serialized JSON; source context
usage is `metrics.estimatedOutputTokens` (under diagnostic metrics when projected).

Evaluation separates exact symbol linkage, reviewed alternative implementations
and literal evidence of facts. Alternatives are explicit, source-reviewed labels,
not an LLM judge. Identical values in unrelated declarations do not establish
dependency provenance. Learned weights remain experimental. No Luna or proposer
calls are part of this implementation or validation.

See [directed packet validation](jev-directed-packets-2026-09-24.md).

## Localized witnesses and open dependencies (current)

The current evidence contract is `evidence-v9-structured-locations`. This
supersedes the aggregate sufficiency check described above. Each literal query
requirement is evaluated against a root symbol and its selected, directed
dependencies. Separate roots are separate requests; unrelated search hits do not
become one apparent implementation. Each accepted witness identifies its exact
source keys and SHA-256 content hashes. AST statement landmarks accompany full
bodies, preserving guards and control flow. They locate evidence, not prove it.

Three-way relation checks (`supports`, `contradicts`, `says_nothing`) are now
always used for final requirements. The legacy `jevVerifyAspects` flag is accepted
for compatibility; false no longer disables this check. A supporting witness must
answer the entire literal requirement. The redundant global `complete` Noul was
removed after live tests demonstrated false rejections of complete source sets.
No model-generated quotation, function name or source span is accepted.

Before trusting sufficiency, a bounded inspection resolves calls from the actual
selected packet and judges up to eight missing definitions with their callers.
Necessary definitions can replace unprotected tails within the existing token,
result and scope caps. Necessary callers and dependencies cannot be evicted by
this packing step. Necessity, per-requirement dependency and contribution share
one request with selected context. Inspection refreshes after packet changes,
up to three passes within the deadline. Scores are not averaged or multiplied. The policy uses
separate uncalibrated thresholds: .65 admission, .8 witness support, and .2 as
the lower edge of necessity uncertainty. These are not accuracy guarantees.

`jev.dependencyCheck` reports inspection status and pending source identities.
A direct verdict cannot override a missing required/uncertain definition, changed
source hash, or incomplete enabled inspection. Diagnostics may therefore report
some supported requirements while the overall packet remains partial. This does
not prove repository-wide absence or resolve every language/dynamic call.

`scripts/research-jev-sufficiency.mjs --live --output <directory>` runs a bounded
manual-feature AutoResearch experiment: Jev measures three reviewed questions;
development-only selection minimizes false sufficiency before maximizing correct
coverage. Training stops after development measurement. A separate
`--test-frozen` invocation evaluates disjoint test groups once per output directory.
Artifacts remain shadow policies. No Luna, proposer, or learned runtime weights
are activated. `--runtime-only` replays the metamorphic packet suite without
feature selection and explicitly labels previously used cases as regressions.
The six synthetic families test removal of definitions, unrelated equal-valued
constants, candidate order and distractors. They are not a production benchmark.

The historical query set stays unchanged. `jev-witness-targeted.json` separately
distinguishes locating a rejection site from explaining exact accepted bounds.
Validation and limitations: [witness report](jev-witnesses-2026-09-25.md).

Design references: [citation checking](https://docs.typesafe.ai/cookbooks/citation_check),
[pre-parsed extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook),
[uncertainty handling](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook),
and [feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery).

## Structured evidence contract v9

Source sets are native `evidenceState` fields: full sources, stable AST location
IDs, hashes, resolved caller edges, referenced constants, pending definitions and
inspection limits. Literal requirements live in `state.requirements`.

Each requirement asks relation, source-location and gap questions in one request.
Locations are supplied statement/whole-symbol IDs or `none`; generated spans are
rejected. Complete witnesses require support, a valid location and sufficient
no-gap mass. Full functions remain present: a selected line alone does not prove
a composite rule. Gaps distinguish `missing_definition`, `missing_value`,
`wrong_operation`, `ambiguous`, and `none`, guiding existing-call/literal recovery.

Packet identity includes query, requirements, source content, truncation, edges,
constants, inspection and contract version. Recovery cannot reuse a verdict
merely because IDs match. Inspection refreshes existing edges and dependencies
after selection changes. Uninspected changed packets remain partial. Pending
dependencies mark only identified requirements missing; unknown scope stays
explicitly partial instead of claiming that every requirement failed.

Coverage counts admitted helpers too. A cheaper independent implementation
bundle can replace the initial anchor only with no weaker requirement coverage.
Required callers/dependencies and unique coverage are protected during packing.
Policy thresholds are centralized in `jev-policy.ts` and remain uncalibrated.

### Manual discovery rounds

No proposer model is used. A proposal JSON contains `questions` and `screening`.
Each question needs source-reviewed `answerableFromState`, `atomic`, `applicable`,
`variable` booleans and a `rationale`. Do not mechanically mark these true.
Measurement accepts `--questions proposal.json` and uses the runtime witness
builder. Feature admission must hold within one witness, never maxima from
unrelated source sets.

The offline command is:

```sh
node scripts/jev-discovery-round.mjs --measurements measurements.json --proposal proposal.json --output round.json --previous previous-round.json
```

Omit `--previous` for the first round. It checks question hashes, rejects non-dev
observations, requires three development groups, performs leave-one-group-out
validation, emits false-complete/abstention errors, records added/revised/removed
questions and signals plateaus. Artifacts cannot overwrite an earlier round.
Revise from dev errors, measure the new contract separately, then freeze before
`--test-frozen`. A consumption marker prevents accidental holdout reruns in the
same directory. Existing synthetic families remain reused regression cases.

Selection prioritizes false completeness, labelled usable requirement coverage,
dependency recall, correct completeness and question count. Coverage, recall,
tokens and latency are reported only when recorded; missing labels are not
inferred from Jev scores. Real retrieval/context labels remain necessary for
claims of end-to-end improvement. Learned policies stay shadow-only.

This implementation pass used build/type checks and static syntax review only.
Regression cases were added/updated but not executed, respecting the pause on
tests. No OpenRouter calls were made (US$0). No accuracy gain is claimed.

References: [API/state](https://docs.typesafe.ai/api),
[Choice](https://docs.typesafe.ai/primitives/choice),
[fan-out](https://docs.typesafe.ai/patterns/fan-out).

## Reviewed evaluation runner

`scripts/evaluate-jev-reviewed.mjs` consumes the 30-case manifest with explicit
dev/validation/reserved phases and local/selection/recovery arms. It checks source
hashes, build identity and strict index snapshots. Expected answers never enter
the inference payload. Complete AST source containment is measured separately
from model sufficiency; fact bindings map reviewed claims to necessary sources.
These are provenance proxies, not independent semantic correctness scores.

Initialize a fresh ledger with `scripts/initialize-jev-budget.mjs <ledger-path>`.
It reads current public endpoint pricing and refuses unsupported/nonzero output
pricing. The evaluator injects `jev-budget-preload.mjs` into every paid child.
Synchronous reservations shared across processes cover the maximum advertised
full-context input charge with a 2x margin. Unknown costs retain the reservation;
confirmed usage releases unused funds. The aggregate ceiling is US$0.50, and
provider authorization/quota rejection blocks subsequent calls. No retries or
concurrent calls bypass the ledger. This is application accounting based on the
captured provider tariff, not a provider-side billing limit.

Development replay uses `calibrate-jev-reviewed.mjs`; validation/reserved phases
require a frozen configuration. `summarize-jev-reviewed.mjs` reports all 90 runs.
Existing output files prevent accidental repeat consumption of a split.
See [the recorded evaluation](evaluations/jev-v9-reviewed-2026-09-25/REPORT.md).

## Retaining candidates and inspected packets (v9.1)

The initial shortlist keeps its established helper and retrieval reservations.
Only when recovery is enabled, an omitted local context winner replaces the lowest-priority available
non-anchor, protecting retrieval leaders and preferring to retain helpers. This
is bounded by the original candidate cap; it never forces semantic acceptance.
Jev still assesses eligibility. Local ordering remains unchanged. Selection-only
retains the original shortlist: the priority experiment regressed that arm.
Recovery seeds selection with the packet already inspected, then admits useful
complements within the same token/result limits. Unassessed retained sources stay
unassessed. Final witness and unresolved-dependency checks remain mandatory.

For repeated research, pass `--budget <existing-ledger-path>` to the reviewed
runner. Never initialize another ledger to reset a cumulative budget.
The v9.1 replay reuses the v9 ledger and previously consumed cases; it is a
regression comparison, not a fresh holdout. The cache contract is versioned.

This follows the distinction between shortlist coverage and reranking quality in
[the reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe), and
focused judgments over explicit context in
[Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Query scope, literal sources and dependency continuation (v10)

The `evidence-v10-query-scope` contract assesses the query independently of source
code. An open question can be answered positively or negatively; a negative
answer is not automatically a contradiction. Only confidently classified open
query facets use `supports / says_nothing`. Assertions, uncertain interpretation,
and caller-provided requirements retain the contradiction option. Invalid Choice
distributions are rejected before adaptation. Missing definitions, unresolved
required dependencies and witness checks still veto completeness.

Standalone candidate judgments exclude caller bodies to avoid crediting a helper
for behavior implemented only in its caller. Dependency and obligation judgments
receive bounded, explicit caller context. Expanded helper content is reconstructed
from validated current source line ranges, rather than embedding-enriched stored
text; malformed ranges and stale sources cannot become evidence.

Dependency inspection filters graph targets by symbol, prioritizes dependencies
of already selected helper descendants, and continues partial inspection instead
of repeatedly processing the same first batch. Decisions are reusable only for
the same packet fingerprint and source hash. Traversal priority does not establish
relevance or necessity, and partial inspection does not establish completeness.

For this research session the user explicitly extended the cumulative allowance
from US$0.50 to US$1.00. The existing ledger retains every previous charge and
uncertain reservation. Its maximum accepted cap is US$1.00; the initializer still
defaults to US$0.50. Request metadata and settlement are written in two atomic
transactions per request to avoid repeatedly rewriting the full audit history
inside model deadlines. This is a research harness, not a provider billing limit.

See the [v10 evaluation](evaluations/jev-v10-optimized-2026-09-25/REPORT.md).
These changes follow [explicit state](https://docs.typesafe.ai/concepts/state),
[closed Choice alternatives](https://docs.typesafe.ai/primitives/choice), and
[Jev's documented context sensitivity](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Implementation packages (v11)

Jev-enabled `context` now evaluates bounded implementation packages before selecting
sources. The default candidate pool for context is 32 (search remains 20); an
explicit `--jev-candidates` is respected. A package contains a root and available
directed helper/constant sources, up to eight physical definitions. Graph membership
is a candidate-construction rule, not evidence of necessity or completeness.

For this context path, `--limit` bounds selected packages; output can contain more
physical source rows, up to 40, within the same estimated source-token budget.
`jev.packages` records root/source identities, bounded expansion and exclusion
reasons. Each physical source keeps its original path and line range. Shared sources
are counted once. Package admission is atomic: a package that cannot fit is skipped,
not silently stripped of its dependencies. Ordinary search retains symbol-count
semantics, and disabling Jev retains the local context behavior.

Selection no longer subtracts independent probabilities to infer redundancy.
Distinct useful sources can have identical probabilities. Explicit literal query
clauses can still prioritize uncovered requirements, while completeness is evaluated
separately. Conditional contribution compares an alternative against the actual
selected sources. A shared dependency does not collapse distinct web/mobile roots.

The final context is checked as one explicitly enumerated source set: complementary
operations do not need a call edge between them. This does not invent graph edges,
merge paths/line ranges, or bypass missing-definition/location/dependency gates.
Initial package scores are not assigned to individual helpers. Failed/uncertain
judgments and incomplete dependency inspection remain visible.

`scripts/evaluate-jev-reviewed.mjs --candidates 32` freezes the requested candidate
count alongside build/index identity. `scripts/analyze-jev-packages.mjs <directory>`
exports source-coverage summaries and package audit rows for reviewing family-level
failures. Those rows are not automatic semantic training labels. Learned policies
remain unpromoted until reviewed outcomes and fresh grouped validation support them.

Package context defaults to a 30-second Jev deadline and preserves time for dependency
inspection and final verification. Named-import value references (including aliases)
supplement calls when constructing packages; shadowed local bindings are excluded.
Final verification removes repeated caller bodies from relation metadata while keeping
the original source bodies and identities. Whole-symbol witness locations bound the
joint request metadata without silently cutting source code.

The [v11 evaluation](evaluations/jev-v11-final-2026-09-25/REPORT.md) documents the
matched source-coverage gain, remaining failures, budget stop and separate live
verification of the compact payload. It does not establish end-to-end answer accuracy.

## Balanced discovery and conditional context (v12)

The full-package candidate limit (32 by default) is preceded by a separate discovery
stage: at most 240 retrieved rows are grouped into at most 160 file catalogs, with
up to 12 excerpts per catalog. Eight catalogs share a request; the stage has a
bounded six-second allowance within the overall deadline. Catalog judgments nominate
files for full-source evaluation and never establish evidence. Discovery is bounded
to the already retrieved, scoped source universe; it does not search the entire disk.

Local and vector leaders are interleaved so subsequent prefix limits preserve both.
Nominated runtime declarations precede type-only declarations. Complete-code judgments
explicitly admit useful negative answers to whether-questions. Ranking applies a
separate scope-compatibility gate: generic HTTP behavior in another service cannot
qualify merely because it resembles the requested operation. Ranking applies a
token-budget preference to the existing uncalibrated application utility; it does
not reinterpret a probability as answer accuracy.

Context starts with at most two packages and can preserve one additional strong
implementation from a different file, within the same budget. This retains plausible
variants before novelty filtering can hide them. Up to three conditional rounds consider
additional rules, dependencies and contrasting implementations against the actual
selected sources. Five is a maximum, not a target to fill with related scaffolding.
On provider rejection, the original local packet is retained. Missing known local or
relative-import definitions make dependency inspection incomplete; built-ins and
callback parameters do not masquerade as unresolved local definitions.

When the leading result is a helper, an independently useful direct caller can take
the second seed slot if its symbol contributes an explicit query term absent from
the helper's symbol. This keeps a requested workflow's error propagation beside its
parser instead of preferring an unrelated parser. A helper-only query does not
automatically promote wrappers. The same source/token limits still apply.

Diagnostics expose discovery nominations, package judgments and final exclusion
reasons. An explicit `--jev-timeout` still overrides the default. Learned weights
remain separate from these deterministic selection changes.

Final v12 validation and remaining retrieval limitations are recorded in the
[acceptance report](evaluations/jev-v12-acceptance-2026-09-25/REPORT.md).
The final frozen run recovered every reference source in 27 of 29 positive
regression queries; this is source coverage, not answer accuracy or a holdout result.
