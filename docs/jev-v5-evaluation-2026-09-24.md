# Jev v5 — question screening, evidence routing and bounded recovery

Date: 2026-09-24. Local implementation on `works/jev-coverage`, preserving the existing uncommitted v3/v4 changes. No npm release or global installation is included in this evaluation. Jev remains optional; learned weights remain `deploy: false`.

## Implemented

- AutoResearch screens questions for source answerability, atomic meaning, cross-family applicability and variation before full featurization. A deterministic linter rejects explicit counting/arithmetic requests and warns about ambiguity, compound judgments and broad quantifiers.
- Screening examples span development groups. Proposer feedback contains out-of-fold errors and correct examples, using accepted features only. Test rows never reach either operation. Correlation diagnostics and grouped CV guide pruning; feature-column collisions are rejected. Every proposal contract and accepted/rejected decision is retained.
- Noul values and full Score distributions are retained in source-free observations. Score mean/spread remain the supervised features. Transport explicitly decodes UTF-8 on Windows. Frozen ablations compare local, local+structural, local+Jev and all features.
- Advisory result categories distinguish direct, supporting, configuration, test, contradicting, weak and unassessed evidence. Conflicts are preserved; classification does not silently delete unassessed candidates. Source truncation invalidates the category.
- Optional final verification uses supports/contradicts/says_nothing per literal requirement. Open questions are not converted into asserted facts. Distributions/partitions are retained; missing code does not establish absence and cross-partition coverage remains partial.
- Optional depth-2/3 recovery traverses source-checked resolved calls with bounded frontier, candidate count and shared deadline. It handles cycles and existing intermediates, rejects invented edges and retains local fallback. Relevant delegation with an explicit missing-helper signal can trigger exploration without becoming direct answer evidence.
- CLI and core/MCP search expose independent rerank/evidence/recovery stages while retaining `--jev both`. New full-factorial evaluation verifies both index snapshot and compiled binary identity and retains failed/partial arms.

Usage and reproducible commands are in [jev.md](jev.md). New controls: `--jev-stages`, `--jev-verify-aspects`, `--jev-recovery-depth`, `--jev-beam-width`. Default recovery depth stays 1; three-way verification and deeper traversal are experimental. Default candidate batching remains 5, with 1 available for isolation.

## Documentation basis

[AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) informed screening, error/correct feedback and structural baselines. [RAG passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) informed explicit evidence categories. [Citation checking](https://docs.typesafe.ai/cookbooks/citation_check) informed the three-way relation, adapted to literal questions without inventing premises. [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) motivated bounded multiple-path exploration. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) informed question linting and keeping arithmetic/graph traversal deterministic. Cookbook benchmark gains are not claimed as Sensegrep gains.

## Real-source AutoResearch

The fixture contains **70 reviewed query–candidate pairs**: 46 development pairs across payout policy, cryptography and email, plus 24 test pairs in the SMS family. There are 18 PT/EN queries; paraphrases stay in the same family split. Labels are agent source reviewed, not independent human annotations. Exact symbol pairs include reviewed negatives rather than assuming every unlabelled search result is irrelevant. The source-bearing dataset is ignored under `.jev-local/`; the public manifest contains only queries, symbols and label provenance.

Local retrieval scores are measured; structural features include lexical overlap, source size and function kind. Curated positives may be outside the retrieved pool, so this experiment measures feature usefulness, not retrieval recall.

With **GPT-6 Luna** proposing questions and **Jev 1.13** producing decisions, the corrected two-round run selected `implements_requested_behavior`. Test Brier (lower is better):

| Features | Brier |
|---|---:|
| Local score | 0.082855 |
| Local + structural | 0.095757 |
| Local + Jev | 0.018790 |
| All selected features | 0.032137 |

The run used 120 requests and reported $0.003934529. This is encouraging feature evidence on a small curated task. It is not sufficient for learned default weights: only one repository and one test family are represented. Structural features hurt this sample, reinforcing the need for ablations.

An earlier run found a domain-specific question and worsened test Brier (0.095757 → 0.098274). It exposed Windows UTF-8 decoding and first-family-only screening defects, which were fixed. The prior artifact is retained locally. The same test family was observed across these engineering iterations, so the corrected results are exploratory regression evidence, not a pristine independent generalization estimate.

## Validation and limits

- 318 TypeScript tests across 51 files, 8 Python tests and 5 Node evaluation-script tests passed. Workspace build/typecheck, version consistency and all three release artifact checks passed.
- Earlier stage comparisons interrupted by a concurrent CLI build were retained locally and excluded from final comparisons. The runner now fingerprints the compiled JS and aborts on changes. A transient test fixture was removed from the indexed universe and `.test-indexer/` is now ignored.
- The broad query about checking score/probability consistency still misses `parseJevScores` in the selected context in every arm. Exact symbol lookup finds it. Bounded semantic recovery is not exhaustive reference analysis.
- Learned feature quality, retrieval coverage and agent correctness are distinct outcomes. Agent tasks are read-only repository understanding, not patch-generation benchmarks. Repeated paraphrases are not independent tasks.
- Several runs overlap in time. Their timings are operational observations, not isolated latency benchmarks. Luna is the economical test generator, not a stand-in for production model pricing or behavior.

Source-free detailed artifacts: [research](evaluations/jev-v5-2026-09-24/research-real.json), [CuraAI stage matrix](evaluations/jev-v5-2026-09-24/curaai-stages.json), [Sensegrep stage matrix](evaluations/jev-v5-2026-09-24/sensegrep-stages.json), [Luna agent](evaluations/jev-v5-2026-09-24/agent-luna.json). Final snapshot and compiled-binary checks passed in both repositories. See also [aggregate JSON](evaluations/jev-v5-2026-09-24/summary.json).

## Final stage comparisons

72 CLI executions: 8 cases in 2 repositories, each with 9 configurations. There are 6 positive cases and 2 absent-topic cases; two payout cases share a rule family. No CLI run failed. Two initial remote evaluations were partial and used fallback; these remain in the denominator. Budget-bounded `incomplete` output is not counted as a process failure.

| Stages | All required symbols | Weak evidence on absent topics | Partial remote evaluation |
|---|---:|---:|---:|
| local | 5/6 | 1/2 | 0 |
| rerank | 5/6 | 1/2 | 1 |
| evidence | 5/6 | 2/2 | 1 |
| recovery | 5/6 | 1/2 | 0 |
| rerank+evidence | 5/6 | 2/2 | 0 |
| rerank+recovery | 5/6 | 1/2 | 0 |
| evidence+recovery | 5/6 | 2/2 | 0 |
| all | 5/6 | 2/2 | 0 |
| experimental | 5/6 | 2/2 | 0 |

No arm falsely labelled an absent-topic case as direct evidence. Evidence assessment improved weak-evidence signalling; deeper recovery and three-way verification did not improve required-symbol recall on this sample. This does not justify enabling the experimental options by default.

## Final agent comparison

The experimental arm uses all stages, depth 3 and three-way verification. GPT-6 Luna answers the same three source-reviewed tasks once in each arm; task order alternates.

| Measure | Local | Jev experimental |
|---|---:|---:|
| Correct answers | 3 | 3 |
| Generator input tokens | 79286 | 16395 |
| Generator output tokens | 593 | 549 |
| Search calls | 6 | 3 |
| Explicit file reads | 3 | 4 |

Input tokens fell by **79.3% in this run**, with identical 3/3 correctness. Both arms retain generator nondeterminism; this is a small paired observation, not a proven production-wide reduction. The Jev component cost $0.005348028. Production economics should use the real production model, caching and workload, not Luna's test price.

## Decision

The requested implementation and validation are complete locally. Keep the new controls available, retain the current default batching and one-hop recovery, and keep learned weights off. The strongest observed outcomes are more informative evidence signalling, a promising semantic feature on reviewed pairs, and reduced generator context in the small agent sample. Ordinary retrieval still needs work on the score-validation query. A larger independent corpus and repeated agent trials are required before claiming a general recall or production-quality gain.
