# Jev integration evaluation — 2026-09-24

Implementation branch: `works/jev-evidence`, based on `a063e4d` (Sensegrep 1.17.3). This evaluation does not publish a new package or change the global CLI.

## Method

Compare the installed 1.17.3 CLI with the local implementation using the same frozen CuraAI index: 940 files, 6,513 chunks, Ollama `qwen3-embedding:0.6b`, 1,024 dimensions. Snapshot: `chunks_1790256700685_d9b6a21f8dfd4e0a907b5ffcba9c11fb:1790256707429`.

There are 49 labeled cases: 32 positive searches, six negative searches, and 11 context selections at 1,200/4,000/8,000 tokens. Fifteen positive searches have symbol-level expectations. These include previously used queries; this is a regression comparison, not an independent held-out generalization benchmark.

Execution order alternates. Query embeddings reuse the existing cache. The final comparison disables the Jev cache and uses `--jev both`, 20 candidates, four concurrent requests and an 8-second Jev deadline. The runner checks strict index verification and snapshot identity before/after, as well as serialized context budgets. Model returned by OpenRouter: `typesafe/jev-1.13-20260917`.

## Final A/B results

| Metric | Local 1.17.3 | Jev enabled |
| --- | ---: | ---: |
| Expected file in top 5 | 30/32 | 30/32 |
| Expected file in top 10 | 32/32 | 32/32 |
| Expected symbol in top 5 | 14/15 | 14/15 |
| Mean reciprocal file rank (higher is better) | 0.582 | 0.751 |
| Context contains expected symbol | 11/11 | 11/11 |
| Correct negative-query warnings | 4/6 | 5/6 |
| False weak-evidence warnings on positives | 0/32 | 0/32 |
| Positive-search median latency | 3,031 ms | 4,920 ms |
| Positive-search p95 latency | 3,941 ms | 5,826 ms |

All 49 Jev stages completed, with 980 requests and zero Jev cache hits. OpenRouter reported **US$ 0.056171934** for this final comparison, excluding preliminary tests and other smoke calls. All context budgets and index snapshot checks passed. This demonstrates better ordering and one additional negative detected; it does **not** demonstrate improved top-5 recall.

## Additional acceptance checks

- Build and workspace typechecks passed; 282 tests passed in 47 files. Tests inject mock responses and need no API credentials.
- Version consistency and release artifact verification passed. Production dependency audit reported zero vulnerabilities; no dependencies were added.
- CLI and MCP expose the optional parameters. A real MCP search returned valid Jev diagnostics and stayed within its 1,200-token budget. Schema checks cover search, survey, cluster and duplicate detection.
- Exact lookup of `shouldIgnoreMinimumPayout` skipped Jev entirely.
- A real 100-ms Jev timeout fell back after approximately 104 ms. Result IDs/order exactly matched Jev-off output, and the `convex/lib/patientConsent.ts` file filter remained intact.
- Cache reuse avoided all three requests on a repeated survey. Automated tests verify invalidation on changed source and absence of source/credentials in stored cache entries.
- Three payment groups received the `payments` category. Specific original labels remain visible, for example `payments / actions / configure pix payout`.
- Duplicate comparison recognized distinct behavior in consultation-payment, medical-order and subscription-invoice status normalizers. It reported shared structure 0.91, same rule 0.06 and different behavior 0.96. Manual source inspection confirmed different accepted statuses and mappings. Those scores are model judgments, not calibrated probabilities of equivalence.

## Interpretation and remaining limits

Jev improves ordering of several existing candidates: consent and voice-draft rules move from fourth to first, while the broad crypto helper moves from ninth to eighth. It does not expand retrieval or change the graph.

The Portuguese Kubernetes negative receives a weak-evidence warning. Terraform/Neptune remains unassessed at the default 20-candidate limit: only four of the first five final candidates were evaluated after diversification. The diagnostic explicitly records this incomplete assessment; it does not assert sufficient evidence or repository-wide absence.

The evidence threshold (0.2), reranking weights and taxonomy threshold remain experimental. Six negatives are too few for production calibration. Keep Jev opt-in and compare future changes with the same cases, plus additional independently labeled queries. Live latency includes CLI startup, local retrieval and network variability; it is a measurement of this run, not a service guarantee.

Reproduction command and semantics: [Jev documentation](jev.md). Cases: [49-case fixture](../scripts/fixtures/search-quality-jev-curaai.json). The credential remains in user configuration outside the repository. Source code is transmitted only on explicit Jev-enabled commands.
