# Search evidence and context selection

Search now keeps a primary result per file and may include one additional distinct symbol when it contributes a referenced rule/value or a separate requested operation. The first five file anchors remain diverse. Explicit `--max-per-file` remains a strict override, including `0` for no cap. Exact lookups retain their existing default of two.

Behavior questions favor relevant executable implementations, including functions that consume a highly ranked constant. This changes the representative within a file while preserving the file's relevance. Queries explicitly asking for constants/default values do not receive this preference. Context selection combines relevance, symbol coverage, referenced helpers, novelty, and bounded size penalties; it prefers complete snippets and marks unavoidable partial source. Structurally linked helpers that cover another requested operation can survive the general relevance cutoff and receive a complementary-evidence bonus before a large peripheral chunk consumes the budget.

## Context budget

`context` and `audit` already default to **12,000 estimated output tokens**. That default is preserved. Use **4,000** for a smaller everyday pack or **8,000** for multi-file investigation. An explicit 1,200-token budget is still supported and tested as a stress case.

```sh
sensegrep context "authentication role refresh" --max-tokens 4000 --json
sensegrep context "payout encryption and transfer" --max-tokens 8000 --json
```

These are output budgets, independent of the embedding model's input window and indexing chunk policy. JSON metadata also consumes the serialized byte budget, so increasing context tokens without increasing an explicit `--max-output-bytes` may still truncate results.

## Local helper expansion

Hybrid natural-language searches examine at most six source files among the first 24 candidates and collect at most 32 relevant call relationships. Only same-file and unambiguous relative-import calls in JS/TS are resolved; aliases in named imports are supported. Related symbols from the imported module can contribute a separately requested operation. They are annotated as module-related, not as direct calls.

Expansion uses one hop, at most 256 indexed rows, source files up to 512 KB, and a 750 ms wall-time deadline. It verifies the source hash against indexed call-site ranges, preserves file/subdirectory/Git scope and structural filters, avoids embedding requests, and falls back to the initial candidates on failure. Diagnostics expose time, candidates, added results and truncation. Exact, pattern and non-hybrid searches do not expand helpers.

This is retrieval assistance, not an exhaustive call graph. Package aliases, namespace imports, re-exports and non-JS/TS call resolution remain outside this bounded expansion.

## Insufficient evidence

`answerSufficiency: "weak-evidence"` is an advisory when returned candidates lack support for most meaningful query terms, or no candidates were found. It does not remove results or prove that a feature is absent. Scope errors remain separate.

`evidenceAssessment` identifies the heuristic and matched/missing terms. It explicitly reports `calibrated: false`: this is not a calibrated probability of correctness. Positive lexical support remains `not-assessed`, never “answer proven.” Portuguese queries against English code are treated conservatively; lack of vocabulary overlap alone does not trigger the warning unless multiple named technical terms are also unsupported. Other cross-language cases need additional evaluation.

## Reproducible comparison

Build the candidate, retain a baseline CLI, and use an existing indexed code snapshot:

```sh
node scripts/evaluate-search-quality.mjs --root /path/to/CuraAI --baseline /path/to/baseline/main.js --cases scripts/fixtures/search-quality-curaai.json --output /tmp/search-quality
```

The checked-in manifest contains historical regressions, symbol targets, new control questions, negative queries, and context budgets of 1,200/4,000/8,000 tokens. It is a CuraAI-specific evaluation set, not a general benchmark. Some historical file targets may become obsolete as that application evolves; inspect symbols and source before interpreting a miss.

The runner alternates baseline/candidate execution, warms the query cache, records wall time and internal diagnostics, and requires a fresh, unchanged index snapshot. Use `--cache reuse` to reuse an already warmed cache and `--cache off` in a separate run to include embedding latency. Output includes per-command JSON, file/symbol ranks, context membership, median/p95, negative warnings and false warnings. Neither mode indexes or installs packages. Scope correctness, deadline fallback, strict caps and token ceilings also have provider-independent unit tests. The separate `search-quality-context-curaai.json` manifest validates content-bearing output and its serialized byte ceilings.
