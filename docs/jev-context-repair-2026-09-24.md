# Jev context repair — 2026-09-24

## Implemented behavior

- Nonempty remote packets can recover bounded local anchors and verified complements.
  Token limits, result limits and explicit file/symbol diversity remain enforced.
  Retained uncertainty is not counted as established aspect support.
- Contribution and packet completeness are separate questions. A high score for one
  aspect or one implementation alone cannot satisfy the direct-evidence gate.
  Completeness is still a fallible model judgment, not an exhaustive code proof.
- Bounded one-hop discovery starts from local anchors before semantic admission.
  Existing candidates acquire call relations without replacing source or local rank.
  Caller source is supplied separately with a 4,000-character bound/truncation flag.
- Recovery distinguishes already retrieved from already evaluated candidates, merges
  repeat identities, and retains uncertain resolved helpers without calling them direct.
- The judging shortlist reserves more verified dependencies. Default flexible file
  diversity no longer eliminates complements before coverage selection. Explicit
  caps remain strict, including after packet repair.
- One candidate per state is the new default; up to four requests run concurrently.
  Multiple questions about that candidate share its state. Explicit larger batches
  remain available. Partial aspect coverage can trigger isolated re-evaluation when
  batching was explicitly requested.
- Referenced constants retain dependency identities even when their scores need no
  promotion. Missing constants can therefore participate in context repair.

## AutoResearch and calibration

`--contextual` measures a candidate against up to three short complete symbols from
its frozen local packet, excluding itself. This is a reproducible contextual
baseline, not a dynamically re-evaluated greedy selection at every insertion.
`--encoding distribution` supports all Score probabilities; the accepted feature in
this run was a Noul, so this run does not demonstrate a benefit from Score encoding.
Exact question batches, selected state, model and encoding remain part of replay.
A changed seed state/encoding is rejected. These selectors remain offline.

The first contextual run rejected oversized source: the old dataset included a
105,463-character symbol marked complete. It did not silently accept truncated
feature measurements. The next run excluded 36 candidates longer than 12,000
characters (380 -> 344). Required labels were not used for filtering. Original
baselines are retained, and sameSelectorLocal is the comparable filtered-pool control.
`prepare-jev-context-measurement.py` makes this preprocessing reproducible.
The failed attempt incurred some calls; its cost is not included in the successful
run's usage total. No successful artifact was created for that failed run.

Two discovery rounds with GPT-6 Luna accepted `direct_requested_behavior`.
Grouped development CV completed 19/19 packets versus 15/19 for the same structural
selector with local scores. The blend is 50% predictor / 50% local. This is not a
like-for-like increase from the prior 18/19 because the candidate pool and state
changed. Approximately 68.5% of selected candidates remain unreviewed.
Successful discovery recorded 696 fresh requests and $0.055842 provider cost.

Frozen evaluation on two analytics-privacy questions (one new family) completed
1/2 with learned weights and 1/2 with the local structural control. Learned nDCG
was 0.5000 versus 0.6186 for that control. The family was excluded from discovery;
this tiny check cannot establish generalization. The initial CLI check for this
family used the intermediate v2 build and is retained as `reserved.json`, not
presented as a final-build validation. All previously used families are regression
data, not new holdout data.

An experimental isotonic calibration of the accepted Noul used 24 reviewed DEV
examples for fitting and eight SMS-family examples for validation. Brier improved
from 0.017225 to 0.002551. This calibrates that particular feature/state contract,
not every runtime evidence score. The sample is too small for production threshold
promotion; the artifact remains `deploy:false`. Runtime 0.2/0.65/0.8 boundaries are
still heuristic policy thresholds. No claim of domain-wide calibrated probabilities.

## Runtime and agent validation

See `evaluations/jev-context-repair-2026-09-24/runtime-verified.json` for the final
build comparison: 12 queries across local and Jev (24 commands), frozen index and
compiled-JavaScript fingerprint checked before/after. Earlier runs are retained.
Some earlier runs overlapped remote research/agent calls; their latencies are not
controlled measurements. The final CLI run is executed without other remote work.

The agent benchmark (`agent.json`) used GPT-6 Luna for six tasks, each with and
without Jev, one repetition. Exact JSON comparison yielded 5/6 in both arms.
The local miss was capitalization of AES-256-GCM; the Jev miss added a correct
32-byte explanation to the expected `base64` string. Manual inspection finds no
factual error in those two answers. Do not report either as a retrieval failure or
claim a Jev accuracy win. This benchmark preceded the final diversity/parent-retention
hardening; its exact artifacts are preserved rather than relabeled as another build.

No learned weights, calibrated thresholds or deep traversal were promoted. No
commit, push, npm publication or global CLI update was performed in this task.

## Validation

- 334 Vitest tests in 52 files passed with four workers.
- 26 Python tests (18 context research, five discovery, three calibration) passed.
- Five Node evaluator tests passed.
- `npm run check` (build plus all workspace typechecks) passed.
- `git diff --check` passed.

An earlier unrestricted parallel test run hit the existing 750ms helper-analysis
wall deadline under load. The bounded-worker full suite passed; the runtime deadline
was not increased merely to hide the test timing issue.

## Reproduction

```sh
python scripts/prepare-jev-context-measurement.py <linked-dev.json> <measurable-dev.json>
python scripts/autoresearch-jev-context.py train <measurable-dev.json> <new-model.json> --live --proposals scripts/fixtures/jev-manual-features.json --contextual --encoding distribution --rounds 1 --max-cost 2 --max-requests 2600
python scripts/prepare-jev-context-measurement.py <linked-test.json> <measurable-test.json>
python scripts/autoresearch-jev-context.py test <measurable-test.json> <new-heldout.json> --live --artifact <new-model.json> --max-cost 1
```

References: [RAG classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages),
[reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe),
[AutoResearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery),
[Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).


## Direct engineering review (no Luna)

After the user's workflow change, no additional proposer or agent-Luna calls were
made. Earlier research/agent runs are historical artifacts, not the basis for
claiming the following implementation is correct.

Direct control-flow inspection found a second semantic selection after packet
repair: `selectWithinTokenBudget` applies a relative-score admission gate and
reranks candidates. Calling it after dependency repair discarded low-scoring
helpers that had just been restored. The finalization now applies only explicit
diversity caps and recomputes token usage; it does not make another semantic
admission decision. Repair has already bounded result count and token use.

Recovery also sliced its candidate budget in vector-store enumeration order.
It now orders resolved children by the current caller frontier, then complete
source and bounded implementation length, with deterministic ties. Tests cover
storage-order interference and retrieved-but-unassessed dependencies. A packet
test separately proves that high contribution scores cannot override a low
completeness assessment.

`manual-review.json` is the frozen-build CLI comparison for this revision.
The other runtime reports remain available as earlier revisions. These queries
are regression cases; no fresh generalization claim is made.


The recommended future research command now uses manually authored question sets
(`--proposals`) and only Jev for measurement. It never calls a proposer model in
that mode; proposal JSON is validated and hashed into the output artifact. The
legacy explicit `--proposer-model` route remains available for historical replay,
but is not invoked by the recommended workflow. The manual feature set is not
activated in runtime and has not been represented as a measured quality gain.

Direct-review CLI result: 5/10 complete positive packets with Jev versus 4/10 local; both flagged 2/2 out-of-domain negatives. Median wall time: 6303.0 ms Jev versus 2840.0 ms local. One run per query; this is a regression comparison, not statistical generalization. Crypto helpers, one working-hours query and consent cases remain incomplete.
