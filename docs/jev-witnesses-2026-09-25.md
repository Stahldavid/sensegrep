# Jev: localized witnesses and dependency obligations

## Implemented

- Every literal requirement uses a three-way relation decision against a bounded
  root plus its selected directed dependencies. Accepted witnesses retain exact
  source IDs and SHA-256 content hashes. AST statement landmarks locate guards
  without discarding the enclosing source/control flow.
- Missing resolved callees are inspected before an aggregate verdict can stop
  recovery. Eight candidates maximum; at most three uncertain candidates receive
  one recheck against the actual selected context. Uncertainty remains visible.
- Required dependencies can replace unprotected tails, preserving their callers,
  result caps, token budgets, structural filters and explicit file diversity.
- Pending required/uncertain dependencies and unavailable inspection prevent a
  direct verdict. The old global `complete` question was removed after it falsely
  rejected complete synthetic packets despite strong localized support.
- A manual-feature AutoResearch runner prioritizes false sufficiency, then correct
  coverage. Policy selection uses development groups only, saves a frozen artifact,
  and evaluates separate test groups. The artifact remains a shadow policy.
- Provider 401/402/403/429 responses stop scheduling further batches within an
  evaluation. Only up to four already-running requests may remain. No automatic
  change to credentials, quota or billing occurs.

## Validation

### Frozen CuraAI regression queries

`final-8s.json` contains 24 paired CLI commands, 12 queries, one unchanged index
and one build. These are reused regression queries, not an untouched holdout.

| Measurement | Local | Jev |
|---|---:|---:|
| Reviewed positive symbol coverage | 3/10 | 9/10 |
| Strict original symbol coverage | 3/10 | 7/10 |
| Required source facts | 3/10 | 9/10 |
| Known negative queries detected | 0/2 | 2/2 |
| Observed median wall time | 2.94 s | 6.73 s |
| Requests | 0 | 332 |
| Reported cost | $0 | $0.029653 |
| Command failures | 0 | 0 |

Some synthetic/targeted evaluation overlapped this run. Wall times are observed
values, not an isolated latency benchmark or a causal speed comparison.

The historical working-hours case remains a miss under its original complete
gold: it requires `isWithinWorkingHours` as well as `parseTimeToMinutes`. The new
packet recovers the parser, but selects the appointment validation flow instead
of the original root. It reports partial evidence rather than silently asserting
full coverage. The old gold was not relaxed to claim 10/10.

New targeted cases separate locating a disabled-day rejection from explaining
exact numeric bounds and inverted windows. Both local and Jev-requested commands
returned the required sources. However, later Jev-requested runs used local
fallback after provider quota rejection. These are NOT credited as successful
Jev semantic evaluations. See both `targeted-8s.json` and the retained
`targeted-isolated-8s.json` failures/fallbacks.

### Metamorphic packet evaluation

Thirty synthetic, source-reviewed packets in six behavior families:

- 18 complete packets: 18 recognized as direct evidence.
- 12 packets missing a required implementation/value: zero falsely declared
  complete.
- Reordering and unrelated distractors preserved the expected verdicts.
- 60 requests, $0.002580 reported cost, no unavailable assessments.

This is `final-regressions/runtime.json`, a reused regression suite. It is not
production accuracy, and it does not establish recall on arbitrary repositories.

### AutoResearch

The earlier `research/` run used three development families and three disjoint
test families (15 variants each). Manual questions only; no Luna/proposer calls.
The frozen shadow policy selected `answer_present >= .9`:

- Development: zero false sufficiency; 8/9 complete positives accepted.
- Test: zero false sufficiency; 6/9 complete positives accepted.

This small synthetic result does not justify promoting learned weights. The
runtime's subsequent removal of the redundant global completeness veto was
validated on the reused 30-case regression suite, not presented as another
untouched test. Original measurements and the frozen policy remain available.

### Local checks and final defensive changes

The implementation has source-level tests for removal, mutation, truncation,
unrelated same-valued constants, order/distractors, uncertain decisions, and
packing under both caps. Full TypeScript suite: 352 tests; one additional witness
choice-consistency regression also passed in the final 32-test Jev suite.
Evaluator tests: 9.
Build/workspace typechecks, version consistency and whitespace checks pass.

After the successful remote suites, a minimal diagnostic confirmed HTTP 403:
`Key limit exceeded (monthly limit)`. Live evaluation stopped. Two final
defensive changes—requiring an explicit `supports` choice as well as its numeric
mass, and stopping batches after authorization/quota rejection—were validated
locally; they have no new successful live run because of that provider limit.

The published/global CLI remains 1.18.0. Work is local; no release was performed.

## Artifacts and references

- [Final paired CLI report](evaluations/jev-witnesses-2026-09-25/final-8s.json)
- [Final packet regressions](evaluations/jev-witnesses-2026-09-25/final-regressions/runtime.json)
- [Research result](evaluations/jev-witnesses-2026-09-25/research/summary.json)
- [Frozen research policy](evaluations/jev-witnesses-2026-09-25/research/frozen-policy.json)
- [Citation checking](https://docs.typesafe.ai/cookbooks/citation_check)
- [Pre-parsed extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)
- [Uncertainty](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook)
- [AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)
