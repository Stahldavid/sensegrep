---
name: sensegrep-cli
description: Discover code behavior with sensegrep CLI semantic search, or verify known text and exhaustive occurrences with literal search when the CLI is available.
---

# sensegrep CLI

Use the existing CLI for conceptual code discovery; use literal search for exact evidence. MCP is an alternative only when its tools are actually exposed and the task permits its effects. A skill file does not install the engine or prove discovery.

## Before running

- Locate an existing binary and check `sensegrep --version`. Windows PowerShell can use `sensegrep.cmd` when execution policy blocks the npm ps1 wrapper; no policy change is needed. Missing binary/index/provider is a limitation, not authorization to install, download a model, configure credentials or start a server.
- Fix the project `--root`, index/profile and evidence universe. A subdirectory root can reuse the nearest indexed parent, scoped to that subdirectory. Indexing writes index/cache/checkpoints and may send source to the resolved embedding provider; run it only within task scope.
- For local-only work, confirm resolved provider/model/endpoint with ordinary `selftest`, accounting for CLI/environment overrides of global config. Ollama's local example is `qwen3-embedding:0.6b`, 1024 dimensions, `http://127.0.0.1:11434`; this is not proof of the current resolved settings.
- Handle [Jev](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/jev.md) separately. Explicit `--jev off` disables remote evaluation for that command. Mode precedence is explicit flag, then `SENSEGREP_JEV_MODE`, then dedicated credentials, then off. A dedicated `SENSEGREP_JEV_API_KEY` or `jev.json` enables both for search/context; a generic OpenRouter key alone does not. Active Jev sends query, paths/symbols and snippets to OpenRouter even with local embeddings. Remote source transmission/paid calls need task consent; survey/duplicate judgments retain explicit opt-in.
- Do not start MCP/daemon/watch merely to inspect source. MCP watches by default; rg fallback may download a binary. Daemon start is a process action; it does not watch/reindex by default, and `--watch` is explicit. Existing daemon call/status/stop clients avoid loading the core in the caller. Read [runtime setup](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/mcp-setup.md) before runtime changes.

## Route the task

**Routing rule:** Start with `sensegrep search` whenever the task asks where or how behavior is implemented, even if the request contains candidate keywords. Use `sensegrep literal` only when the text or regex is already known, every textual occurrence is required, or you are verifying/refining a semantic result. If unsure, choose `sensegrep search`.

| Need | Tool | Evidence limit |
| --- | --- | --- |
| Where/how behavior is implemented, concepts or exploration | `sensegrep search "domain and behavior" --json` | Discovery, not exhaustive proof |
| Known string/regex, every occurrence or verification | `sensegrep literal "text" --filesystem --json` | Check status, truncation and ripgrep-visible universe |
| Bounded context or changed-code review | `context` or `audit` | Budgeted selection; inspect incomplete coverage |
| Reading map / subthemes | `survey` / `cluster` | Group summaries; expand representative IDs with show |
| Definition, references, impact or trace | Graph commands on existing index | Resolved extracted edges; use compiler tools for complete refactoring |
| Logical duplicates | `detect-duplicates` | Candidate/time caps and snapshot-bound continuation |

Start conceptual search with domain/framework when known; reformulate weak results before raising limits. Avoid premature kind filters that can hide helpers. Identifier-like queries add exact/literal fallback; short identifiers can use `--exact`. If the engine is unavailable or the task forbids its effects, use available source/file-search tools and report the limitation.

`search --pattern` filters semantic candidates; it remains non-exhaustive. It fetches at least 200 candidates (or limit × 3 when larger) before filtering, which still does not prove every occurrence. `literal --filesystem` bypasses the semantic index and embedding config; very small output budgets can force an emergency envelope. Read status/truncation/universe before claiming complete text evidence.

For a starting budget, focused search can use limit 10 / max-per-file 1; exploration 20 / 2; broad discovery 20 / 3. Use forward-slash include/exclude globs, and widen only for missing evidence. Structural filters operate on indexed metadata; parent/import matching and strict metadata flags are not compiler-grade proofs. Zero matching files plus a warning is a scope/glob issue, not proof of absence.

## Interpret results and verify source

Use `--json`; stdout is JSON and progress/warnings use stderr. If streams may merge, `--json --log-format none` suppresses non-fatal logs. JSON schema v2 is minified/minimal by default: canonical id/file/lines/symbol/kind/rank/relevance cards. `--json-detail content` adds code; `--diagnostic` adds rankings/timings/freshness; `full` exposes internals; `compact` aliases minimal; `--pretty` is for human reading.

- Always inspect `schemaVersion`, `command`, `status`, `retrieval.mode`, `retrieval.universe`, `index`, applicable `budget` and structured warnings. Unknown options fail instead of silently applying a constraint; invalid JSON-mode arguments give structured `errorInfo` and exit 2.
- Expand relevant result IDs with `show`, then verify source. `show` reports target-local `index.targetFresh`; use `verify --strict` for global freshness. Persisted graph data is reused until index updatedAt changes.
- Scores, `rankingStrength`/`confidence`, sufficiency and `graphCoverage` are not calibrated answer probabilities or global recall. Graph coverage divides resolved by resolved/unresolved/ambiguous extracted edges; ambiguous same-name impact targets are omitted. Dynamic calls and unsupported aliases can remain unresolved.
- If context is incomplete or retrieval truncated, inspect selected IDs and expand missing evidence with show/source. Small budgets can omit important files. Tree-shaking collapses unrelated source; `--no-shake` exposes hidden context. Canonical lines/ID still locate a full symbol when `contentTruncated`/`contentLines` show a partial card.
- `--max-tokens` estimates output tokens; `--max-output-bytes` bounds final serialized UTF-8 JSON including envelope/pretty/newline. Completion does not imply sufficient evidence. Use structured results/groups/clusters/graph fields; human `output` is compatibility text.
- Survey/cluster JSON defaults to summary; expand representativeIds or request representatives explicitly. Provider failure in cluster must report `retrieval.mode: lexical-fallback` and a warning.
- Report CLI wall time separately from provider/internal timing. Search fuses lexical/vector ranks, optional deterministic rerank, filtering, dedup/diversification, tree-shaking and budget selection. Missing optional rg can leave vector-only discovery; query-vector cache identity/hits are diagnostic, not completeness evidence.

## Coverage and continuation

`audit` without base uses working-tree and untracked changes; with `--base`, state the Git comparison. Read each batch's stable `ranges`, `usedBytes`/`usedTokens` and maxima. `--require-coverage --continue-uncovered` remains constrained by batch/total/output limits: `status: incomplete` and `coverage.truncationReasons` must be reported. Follow the [audit contract](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/cli-reference.md#sensegrep-audit).

For duplicates, scope language/path/min-lines/complexity before raising candidates. Threshold 0.85 is a starting point (0.7 looser, 0.92+ near-identical); `--max-candidates` and timeout can leave partial findings. Inspect truncated/candidates/analyzedCandidates and `continuation.cursor` (full JSON also has summary.resumeCursor). Resume only with the same index, filters and candidate set. Temporary checkpoints preserve prior pairs, bound to that snapshot; changed snapshot/candidates require restart without the cursor. Finishing a capped subset is still incomplete coverage. Read [duplicate flags and continuation](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/cli-reference.md#sensegrep-detect-duplicates).

## Index and input policy

Use incremental `index --no-watch` for authorized updates. Known text lookup does not require indexing. Language detection is automatic; do not pass a language when indexing. Status is metadata-only; status --verify/verbose inspect changed/missing/removed files. Strict verify requires indexed, expectedChunks==actualChunks, changed/missing/removed==0 and isStale==false. An incompatible schema calls for an authorized migration, not silent search repair.

Full indexing stages/checkpoints compatible work and can resume after interruption; `--no-resume` discards interrupted staging. Scoring/policy changes may require full rebuild. Watch refuses mixed policies. Index stderr phases include scan/parse/embed/persist/complete; timeout includes lock wait (bare numbers are seconds, with ms/s/m suffixes), while `--embedding-timeout` limits query embedding acquisition only. `--latency-budget` is a deprecated alias, not a process wall-clock limit.

Read [chunking and tokenizer policy](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/chunking.md) before changing budgets: model capacity, Ollama runtime context, chunk/input batches and context output are independent. Tokenizer JSON must match the model and already be local; there is no automatic tokenizer download. Missing tokenizer means estimates; overflow requires fixing tokenizer/budgets and reindexing, not enabling truncation. Policy/tokenizer identity participates in index signatures. Profiles isolate indexes, not configuration; use the same config/environment for index and search. Search validates endpoint/model fingerprint.

Ordinary `selftest --strict --json` does not call embeddings. `--deep`, benchmark, indexing and uncached semantic queries can call the resolved provider and incur cost. Benchmark measures provider request concurrency, not index workers or Ollama slots; sequential adapters and samples fitting one HTTP batch cannot yield a concurrency recommendation. Benchmark does not rewrite saved config. Index plans separate internal batches from HTTP requests; estimates exclude retries and can overstate embedding work when vectors are reused.

## References by task

These are existing documentation files at the selected source revision. They remain reachable when this standalone skill directory is installed without the rest of the repository; they do not prove the installed CLI is the same version. Check installed version/help before using version-specific flags. If a reference is unavailable, report that limit instead of inventing syntax or running setup.

- [CLI commands, flags, JSON and graph limits](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/cli-reference.md)
- [Search quality, selection and sufficiency](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/search-quality.md)
- [Parallel agents and a shared root/index](https://github.com/Stahldavid/sensegrep/blob/40802d31c5306ff5f17759bb27262ecb7f6ce4e2/docs/parallel-agents.md)

Finish with verified source locations, scope/index identity, evidence used, coverage gaps and any incomplete continuation. Do not translate a successful command into an exhaustive or correct answer.
