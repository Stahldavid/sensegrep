# Reliability fixes validated on Windows

## Behavior

- Incremental CLI indexing copies existing vectors in Arrow batches into a staging generation, applies replacements/removals, verifies its count, and atomically switches the metadata pointer. Failure before activation leaves the previous generation intact. No-change runs do not copy the table. This adds local disk work for changed indexes, but does not re-embed unchanged chunks. Single-file watcher updates are outside this change.
- CLI duplicate JSON now applies `--limit` in minimal, diagnostic and full projections. `summary.total` is the number found; `summary.returned` is the number emitted (`totalDuplicates`/`returnedDuplicates` in full). Output truncation sets `status: incomplete`, `truncated` and `outputTruncated`; it does not invent a continuation cursor. A scan cursor, when present, is preserved. Raise `--limit` to see more groups from the same scan.
- Default search returns at most one result per file. Explicit `--max-per-file` overrides this, and `--exact` retains the two-per-file default. Context selection is unchanged and may select several relevant helpers per file.
- Group labels retain up to seven symbol words instead of four and remove dangling English prepositions/conjunctions.

## Validation

- Typecheck passed; full suite passed with 238 tests, followed by the added no-op regression test (14 indexer tests passed). Release CI runs the complete final suite of 239 tests.
- A real child CLI using Ollama was terminated during incremental persistence. Strict verification found stale source files but **no chunk mismatch**, and the active table name was unchanged. The next incremental run activated a new table; strict verification and exact lookup of the added symbol passed.
- Repeated the 16 CuraAI query cases in default and explicitly diverse modes. Default expected-file top-five coverage improved from 13/16 to 15/16; top-ten remained 16/16. The voice concurrency case improved from rank 10 to 6, so broad semantic retrieval is still not exhaustive.
- Exercised all three duplicate JSON projections with `--limit 1`, checking one emitted group and explicit output truncation.
- Rechecked small context budgets, real call references, cluster labels and index health using the built CLI before release. The installed npm CLI is checked again after publication.

The initial source corpus changed during earlier testing; use these measurements as targeted acceptance evidence, not a universal accuracy claim. `--exact` still prefers exact symbols rather than imposing a strict filter; use `literal` to establish exhaustive textual absence.
