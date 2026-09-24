# Optional Jev evaluation

Jev supplements local retrieval through OpenRouter System One. It remains **off by default**, including when a credential is configured. Enabling it transmits the query, candidate paths/symbols and source snippets to OpenRouter. Embeddings can remain local in Ollama.

## Configuration

Use `SENSEGREP_JEV_API_KEY`, `OPENROUTER_API_KEY`, or `{"apiKey":"YOUR_KEY"}` in the user's `~/.config/sensegrep/jev.json`, in that precedence order. Never put the key in repository files.

```sh
sensegrep search "where are payout keys encrypted?" --jev both --json
sensegrep context "minimum payout eligibility and exceptions" --jev both --max-tokens 4000 --json
sensegrep search "payment eligibility" --jev both --jev-batch-size 5 --jev-ranking score --diagnostic --json
sensegrep survey "payment rules" --jev evidence --json
sensegrep detect-duplicates --include 'src/**' --jev evidence --jev-candidates 5 --json
```

For an unpublished checkout, use `node packages/cli/dist/main.js` after `npm run build`. The endpoint is `https://openrouter.ai/api/v1/systemone` and the model alias is `typesafe/jev-1.13`. Diagnostics include the resolved revision.

| Option | Meaning |
| --- | --- |
| `--jev off` | No remote request |
| `--jev evidence` | Evaluate final source packet, preserve local search order |
| `--jev rerank` | Evaluate/rank candidates, retain local sufficiency assessment |
| `--jev both` | Ranking, context contribution and final-packet evaluation |
| `--jev-candidates N` | Candidate/group cap, default 20, range 1–40 |
| `--jev-batch-size N` | Maximum candidates per request, default 5, range 1–10 |
| `--jev-ranking score` | Ordered relevance rubric, default |
| `--jev-ranking legacy` | Original relevance/evidence/local-score weighted formula |
| `--jev-ranking rrf` | Fuse local and model positions; ordinal, not a probability |
| `--jev-timeout MS` | Shared deadline for ranking, contribution and packet stages, default 8000 |

MCP uses `jev`, `jevCandidates`, `jevBatchSize`, `jevRanking` and `jevTimeoutMs`. Groups and duplicates use evidence mode internally and do not reorder membership. For experiment runners, `SENSEGREP_JEV_BATCH_SIZE` and `SENSEGREP_JEV_RANKING` supply defaults; explicit options take precedence. Invalid environment defaults fall back to supported defaults. Exact identifiers, literal and graph commands do not require remote inference.

## Batches and accounting

Candidates receive stable question IDs within a batch. Each question explicitly identifies its candidate because question IDs alone are not model instructions. At most four requests run concurrently. Batches exceeding a conservative 96,000 UTF-8 byte request bound are split before sending. Provider size errors split multi-candidate batches again. This is a byte heuristic, **not an exact provider tokenizer**; singleton overflow fails locally without silently dropping required evidence.

Ordinary candidate snippets have a 24,000-character bound. Oversized symbols preserve both beginning and end and are marked truncated. Final packets are partitioned at source boundaries with a 60,000-byte target per partition and a separate 70,000-character per-partition ceiling. All partitions must be evaluated without source truncation. A singleton too large to fit remains unassessed. A direct verdict requires at least one partition to answer all requested rules; other cross-partition answers remain partial or uncertain. Query inputs over 8,000 characters fall back locally. The direct TypeSafe provider's limits must not be assumed to apply to OpenRouter.

Output tokens from Jev are free under the documented pricing. We retain useful numeric distributions rather than minimizing answer fields. Source input, question input and additional passes still cost money. Diagnostics report actual provider usage/cost; they do not estimate cost from output token counts.

The seven-day cache hashes the **whole ordered batch**, query, selected anchor, rubric version and model alias. It stores only validated numeric decisions, bounded model identifiers and timestamps: no source, queries, credentials or provider legends. Rearranging or changing any candidate invalidates the whole batch. Alias changes can remain cached until expiry; disable the cache for controlled comparisons using `SENSEGREP_JEV_CACHE=false`.

## Decision contracts

Search evaluates:

- `relevance`: Score levels 0 unrelated, 1 topic only, 2 useful partial implementation/helper, 3 direct implementation or requested setting. Full distributions and confidence are retained.
- `relevant`, `evidence`, `contradiction`: separate binary judgments. A contradiction is never relabeled as support.
- `role`: implementation, helper, constant, test, wrapper or unrelated, with its distribution.

These are **uncalibrated** judgments. A constant can be direct evidence when the query asks for a configured value. The default ranking uses the rubric score, while preserving explicit exact anchors. RRF and legacy weights remain available for paired experiments.

When building token-bounded context with `both`, at most six candidates receive one additional contribution question against the strongest selected anchor. This is a bounded approximation of marginal contribution, not an iterative optimizer over every possible packet. Deterministic selection combines that signal with source overlap, query coverage, resolved helper support and token fit. Source code is never generated or rewritten by Jev.

Context/audit retain their existing 12,000-token default. Use 4,000 for focused questions or 8,000 for broader context; 1,200 remains a stress-test budget. CLI output token limits are independent of free Jev output tokens.

## Final evidence packet

After file diversity and token selection, a separate call judges the exact structured source snippets selected for the response, including candidates that were outside the ranking shortlist. The assessment records a packet hash, result count and separate criteria.

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

Existing local one-hop helper discovery continues to enforce file/changed-file/structural filters and source freshness. With reranking enabled, it may additionally offer direct relative-import or same-file calls without literal query overlap. These extra helpers are kept separate from local ranking/deduplication and admitted only after a complete Jev evaluation with their own answer evidence. Existing source candidates are not replaced by graph-only matches. Discovery remains incomplete and bounded; Jev never invents graph edges.

Missing credentials, malformed answers, HTTP failures or deadlines retain local order. Partial ranking batches do not partially rerank the pool. Contribution-stage failure retains deterministic selection. Packet-stage failure does not imply sufficient evidence. Caller cancellation propagates. Errors never expose provider bodies or credentials.

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
