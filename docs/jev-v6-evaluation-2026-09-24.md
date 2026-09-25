# Jev v6: correcting the decision pipeline toward configured defaults

## What the documentation changes in our interpretation

The previous benchmark is evidence about one integration, not a ceiling on Jev's
usefulness. The production generator may be much more expensive than Luna. Quality,
preserved evidence and end-to-end effort therefore matter more than comparing
Jev's cost to the inexpensive test generator.

1. [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) separates
   relative ranking from absolute candidate fit. Our selector was using high aspect
   values even when the same candidate was explicitly `unassessed`. It could spend
   its budget on that candidate and stop as though the requirement were covered.
   Fix implemented: require absolute eligible evidence; uncertain or partial source
   cannot close an aspect. With no eligible packet, use the original local selection.
2. [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages)
   assigns narrow semantic judgments to Jev and selection decisions to code. Our
   fallback now preserves the pre-Jev candidates/order instead of reusing a remote
   ordering that failed to produce evidence. A weak search is still advisory, never
   proof that a feature is absent from the entire repository.
3. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) identifies
   distracting state and indirection as failure modes. [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)
   batches many questions about the same document; it does not establish that many
   unrelated candidate documents are equally safe to mix. Our controlled isolation
   experiment recovered `parseJevScores`, but lost CuraAI `auth-en`. Fix implemented:
   keep the normal batch, retry isolated candidates only when no eligible packet
   fits, or helper recovery hits its candidate cap with no accepted helper. Retain
   all questions about each isolated candidate in one request. Retry
   shares the original deadline and leaves one second for final packet assessment.
4. [AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)
   learns useful questions/features and a downstream predictor. Our existing loop
   optimizes Brier loss on labeled query-candidate pairs. That does not directly
   optimize top-five rule coverage or useful context. Better pair classification
   can still lose a helper in diversity or packing. Do not equate that result with
   improved agent performance or changes to Jev's own model weights.

## Default behavior implemented in the checkout

Search/context resolve to `both` when `SENSEGREP_JEV_API_KEY` or the dedicated
`jev.json` contains a credential. A generic OpenRouter key alone is insufficient
to trigger automatic source transmission. Explicit `--jev off` takes precedence;
`SENSEGREP_JEV_MODE=off` disables the automatic integration. With no configured
Jev, retrieval remains local. API failures/deadlines retain fallback behavior.

This enables bounded ranking, evidence selection, one-hop recovery, adaptive
isolation and packet assessment. It does not enable deep recovery, AST block
extraction, three-way verification or learned weights. Those remain individually
testable experiments. Survey/duplicate-specific judgments remain explicitly enabled.
No npm publication or global installation is part of this change.

## Learning work that follows this correction

Use the existing loop as infrastructure, but align selection with deployed behavior:

- Freeze candidate pools and label direct implementations, necessary dependencies,
  wrappers, value-only constants, tests and contradictory evidence separately.
  Include hard negatives from the same file and oversized implementations.
- Retain group splits by behavior and repository. Previously inspected queries are
  regression/development cases, not an untouched final test. Reserve new repository
  families before proposing further questions.
- Screen/prune atomic questions as already implemented. Compare a frozen local
  baseline against local-plus-Jev with identical calibration. The earlier raw-score
  external comparison is insufficient to establish a calibrated model advantage.
- Select features/weights on grouped development folds using ranking and context
  metrics in addition to Brier: all-required symbols at five, necessary-helper
  coverage, irrelevant-context fraction and grounded answer correctness. Track
  input tokens and latency separately. Penalize removing a previously correct rule.
- Learn the *incremental usefulness* of a candidate from the query, that candidate,
  and the current selected evidence. Do not ask about information missing from the
  state. Compare this selector to the existing deterministic marginal-coverage rule.
- Deploy learned weights only after a frozen shadow evaluation wins beyond the
  development groups; retain versioned question contracts, model revision and a
  local fallback. Autoresearch should stop on a development plateau rather than
  keep revisiting the test set until it appears favorable.

This is a concrete follow-on learning plan, not a claim that learned weights were
trained or deployed in v6. The first implemented changes correct decision semantics
and add a measured adaptive evaluation strategy.

## Experiment artifacts

`evaluations/jev-v6-2026-09-24/` retains the eligibility-only, forced-isolation and
adaptive-default comparisons. Each stage run disables Jev cache and verifies an
unchanged binary and source/index snapshot. Compare controls within a run: source
edits required reindexing Sensegrep, so raw before/after totals across versions are
not identical-source experiments. Some evaluations ran concurrently; wall times
are observed operational measurements, not isolated service latency estimates.

The six-task agent comparison uses Luna, ordinary caching, hidden source-reviewed
answer keys and one repetition. It tests source understanding, not patch quality or
the production generator. A configured-default smoke invokes `context` without
`--jev` and verifies that `getEncryptionKey` is returned with completed `both` mode.

## Validation and limits of the rollout

Final paired matrix: 50 CLI executions, 25 per mode, across CuraAI and Sensegrep.
Both modes covered every labeled symbol in 16/21 positive queries. Jev signaled
weak evidence on 4/4 absent-topic queries versus 2/4 locally. There were no CLI
failures. Jev recovered `minimum-pt` but lost `auth-en`; equal totals do not imply
identical behavior. All 12 selective isolation attempts completed. Mean observed
CLI time was 4.98 seconds local and 7.53 seconds with Jev. Full results and the
explicit per-query misses are in `cascade-summary.json`. These known development
cases do not demonstrate statistical significance or a general recall improvement.

Typecheck/build passed; all 321 Vitest tests passed on the final code. Local test
execution explicitly set `SENSEGREP_JEV_MODE=off` to keep the ordinary unit suite
offline. Resolver tests independently cover dedicated credentials, generic-key
non-activation, missing configuration, explicit off and environment precedence.
The final live smoke ran without `--jev` or a token-budget override, and returned
`getEncryptionKey` with `both`, `complete`, and a fresh index. Explicit off was also
verified separately.

The final three-task agent run (`agent-cascade.json`) passed 3/3 in each mode.
Generator input fell from 61,708 to 45,246 tokens (**26.7%**); observed mean wall time
increased from 21.31 to 24.30 seconds (**14.0%**). This is a small, one-repetition
check of the affected tasks, not a significant population estimate. The earlier
six-task adaptive version used 29.4% fewer input tokens; its local strict-answer
failure was only `AES-256-GCM` versus `aes-256-gcm`, so do not count it as a substantive
accuracy advantage for Jev.

The automatic configured mode is a user-requested rollout with explicit opt-out,
not certification of uniform superiority. Candidate judgments still vary across
runs: the final matrix retained an authentication miss and did not consistently
recover the score-validation helper, despite improvements in intermediate isolated
runs. These remain development/regression cases for the learning work above.
Do not selectively report only the best run or describe learned weights as deployed.
