---
name: sensegrep-cli
description: "Semantic, structural, and exhaustive literal code evidence via the sensegrep CLI. Use for code exploration, exact text proof, token-bounded context, audits, graphs, duplicates, and agent investigations. Prefer sensegrep search for meaning and sensegrep literal for exact strings; use raw grep only when Sensegrep is unavailable or the filesystem semantics must differ."
---

# sensegrep (CLI) — Semantic Code Search

Search code by meaning, not text patterns, by running the `sensegrep` command-line tool.
Uses AI embeddings + tree-sitter AST parsing. This skill is **CLI-first**: it runs shell
commands and reads their output. It does **not** require the sensegrep MCP server. If the
sensegrep MCP tools are available in your environment, prefer those; otherwise use the CLI
commands below.

## Setup

Install the CLI once (global), then index the project before the first search:

```bash
npm install -g @sensegrep/cli
sensegrep index            # builds the semantic index for the current directory
```

Add `--json` to search, context, audit, survey, cluster, graph, index-health, or
detect-duplicates commands to get
machine-readable output that is easy to parse programmatically. When `--json` is active,
stdout is reserved for JSON; human progress and warnings go to stderr.

Use `sensegrep --version` to confirm the installed CLI version.

## When to Use

- **sensegrep search**: Finding functions/classes by behavior, exploring structure, semantic queries, multi-criteria searches
- **sensegrep literal**: Exact strings and regex proof; add `--filesystem` when the evidence universe must not depend on the index
- **grep/ripgrep**: Fallback only when Sensegrep is unavailable or custom raw filesystem behavior is required

## Recommended Defaults

Start with these defaults and adjust based on what you find:

| Goal | `--limit` | `--max-per-file` | Notes |
|---|---|---|---|
| Focused search (know what you want) | 10 (default) | 1 | Tight, clean tree-shaking output |
| General exploration | 20 | 2 | Balanced — visibly better file coverage than limit=10 |
| Broad discovery (large codebase) | 20 | 3 | Diminishing returns beyond 3; max-per-file=5 rarely adds value |

> When `--pattern` is set, sensegrep internally fetches `limit × 3` candidates before filtering — so the default limit=10 is already enough. Don't inflate `--limit` when using `--pattern`; the pattern does the filtering.

> **Tip:** Use `--include "src/**/*.ts"` to focus on source folders, or add `--exclude "*.md"` / `--exclude "docs/**"` when you want to keep markdown, docs, and changelogs out of results. On Windows, prefer forward slashes in globs (`src/**/*.ts`), though backslash-based indexed paths are now normalized automatically.

> **Identifier queries:** If the query looks like a symbol or framework API (`defineNuxtRouteMiddleware`, `defineStore`, `OrderServiceImpl`), sensegrep auto-adds exact/literal fallback on top of semantic search. For short identifiers such as `emit`, `run`, or `sync`, prefer `--exact`; it promotes exact symbol-name matches and can avoid a slow/weak semantic search.

> **Subdirectory roots:** If the repo root was indexed and you run `sensegrep` with `--root` pointing at a subdirectory, Sensegrep reuses the nearest indexed parent and scopes the query to that subdirectory. You no longer need to reindex every subfolder separately.

> **JSON output:** Search defaults to compact result cards with `resultId` and canonical fields such as `symbolName`, `startLine`, `endLine`, `rawDistance`, and `distanceMetric`; use `sensegrep show <resultId>` or `--json-detail content|full` to expand selected evidence. Rendered Markdown is omitted unless `--include-rendered-output` or full detail is requested. Read `retrieval.actualMode`, `retrieval.universe`, `index`, `budget`, and `warnings` before treating evidence as sufficient.

> **Profiles:** Use `--profile <name>` when comparing embedding models/settings. Profiles have independent indexes. Sensegrep validates a non-secret endpoint/model fingerprint before searching.

## Commands

### `sensegrep search` — Primary search

```bash
sensegrep search "error handling and retry logic" \
  --type function          # function | class | method | type | variable | enum | module
  --language typescript    # typescript | javascript | python | java | vue
  --async                  # async only
  --exported true          # public API surface
  --min-complexity 5       # complex logic
  --pattern "handle|process"  # regex post-filter via ripgrep (applied after semantic search)
  --include "src/**/*.ts"  # file glob include filter
  --exclude "*.md"         # file glob exclude filter
  --decorator "@route"     # filter by decorator
  --parent "UserService"   # scope to class/parent
  --imports express        # filter by imported module
  --exact                  # prefer exact symbol lookup for identifier queries
  --semantic-kind convexMutation # framework-aware kind; aliases and wildcards like convex* work
  --explain-filters        # include whyMatched/filterMatches in JSON
  --strict-parent          # strict indexed parent metadata validation
  --strict-imports         # strict AST import metadata validation
  --has-docs true          # require docs
  --min-score 0.5          # relevance threshold
  --max-per-file 2         # dedup per file (default: 2)
  --max-per-symbol 2       # dedup per symbol (default: 2)
  --hybrid true            # fuse lexical + vector retrieval (default: true)
  --rerank true            # deterministic second-stage reranking
  --max-tokens 8000        # cap estimated output tokens
  --changed --base origin/main # restrict to Git-changed files
  --profile fast           # select a named side-by-side index
  --no-shake               # show full matched snippets when tree-shaking hides the target
  --limit 10               # max results (default: 10)
  --json                   # structured results + text output
```

`--parent` matches parent/class scope by containment, so partial class names are acceptable. `--imports` tries package-name variants (`@scope/pkg`, `scope/pkg`, `pkg`) to reduce false misses in scoped packages.

Hybrid retrieval is the default: lexical and vector ranks are fused before structural filtering. If optional ripgrep execution is unavailable, natural-language search safely falls back to vector results. Use `--no-hybrid` only for controlled comparisons.

### `sensegrep literal` — Exhaustive text evidence

Use this instead of `search --pattern` when every occurrence matters. It skips embeddings and reports whether `--limit` truncated the result set.

```bash
sensegrep literal "X-Goog-Message-Number" --include "convex/**" --json
sensegrep literal "retry|backoff" --regex --ignore-case
sensegrep literal "TODO:" --filesystem --max-output-bytes 50000 --json
```

### `sensegrep context` — Build an agent context pack

Use this when the next model/agent call has a context budget. It enables hybrid retrieval, reranking, diversification, and tree-shaking, then stops before the estimated token cap.

```bash
sensegrep context "authentication request lifecycle" --max-tokens 8000 --json
sensegrep context "billing retry behavior" --include "packages/core/**/*.ts" --max-tokens 12000
```

### `sensegrep audit` — Review Git changes

`audit` is a token-bounded context search restricted to changed files. Supply a merge base for PR-style review; without `--base`, it uses working-tree and untracked changes.

```bash
sensegrep audit "security regressions and missing error handling" --base origin/main --max-tokens 12000
sensegrep audit "security regressions" --base origin/main --require-coverage --continue-uncovered --batch-tokens 4000 --max-total-tokens 8000 --max-output-bytes 32000 --max-batches 8
sensegrep search "affected retry logic" --changed --base HEAD~1 --json
```

`--batch-tokens` is strict. Sensegrep splits large changed files into stable range cards so
no batch exceeds the requested ceiling. For CLI JSON, compare `attemptedOutputBytes` with
`actualOutputBytes` and `attemptedTokens` with `actualEmittedTokens`.

### `sensegrep survey` — Reading map for a theme

Use this when a linear result list is still too noisy and you want a domain-oriented map of the query.

```bash
sensegrep survey "authentication login token" \
  --language typescript \
  --include "frontend-admin/**/*.ts" \
  --limit 4 \
  --per-group 2
```

Returns grouped, tree-shaken reading domains such as `middleware / guards`, `stores / state`, `services / api`, and `types / contracts`.

### `sensegrep cluster` — Break a broad topic into subthemes

Use this when the topic is large or fuzzy and you want semantically coherent clusters instead of a flat top-N.

```bash
sensegrep cluster "price list commission ncm uf packaging" \
  --language java \
  --include "backend-api/**/*.java" \
  --limit 4 \
  --per-cluster 2 \
  --cluster-threshold 0.72
```

Returns cluster headings plus representative tree-shaken snippets, using embeddings + AST metadata + path/import signals.

### Symbol graph — References, impact, and trace

These commands analyze the existing local index without embedding calls:

```bash
sensegrep references loadUser --json
sensegrep impact loadUser --depth 3 --limit 100 --json
sensegrep trace handleRequest loadUser --depth 6 --json
sensegrep references --id "src/auth.ts:20:45:loadUser" --json
```

- `references` lists definitions and indexed reference sites.
- `impact` walks resolved reverse call edges and returns canonical locations. Ambiguous same-name targets are intentionally omitted instead of guessed.
- `trace` finds a reference path between two symbols.

### `sensegrep detect-duplicates` — Find logical duplicates

```bash
sensegrep detect-duplicates \
  --cross-file-only    # only report duplicates in different files
  --language typescript # optional language filter
  --only-exported      # focus on public API surface
  --show-code          # include actual code in output
  --threshold 0.85     # 0.7 = loose similarity, 0.9 = near-identical only
  --min-complexity 3   # skip trivial helpers (getters, guards)
  --max-candidates 1500 # cap broad scans; raise for deeper audits
  --timeout 30s        # return partial findings instead of running indefinitely
  --resume-cursor 0    # continue from summary.resumeCursor on the next call
  --include "src/**/*.ts" # scope duplicate candidates by indexed path
  --exclude "*.test.ts"   # remove noisy paths
  --ignore-tests       # exclude test files
```

`--threshold` guide: use `0.85` (default) for meaningful duplicates; lower to `0.7` for suspicious similarities; raise to `0.92+` for near-identical copies only.

For broad monorepos, start with `--include`, `--language`, `--min-lines`, or `--min-complexity` before raising `--max-candidates`. If the candidate set is larger than the cap or reaches `--timeout`, Sensegrep returns partial findings and reports `summary.truncated`, `summary.candidates`, `summary.analyzedCandidates`, and `summary.resumeCursor` in JSON. Pass that cursor to the next invocation. The envelope always includes `schemaVersion`, `command`, and `status`.

With `--json`, parse stdout directly. Use `--json --log-format none` when stdout and stderr may be merged; it suppresses every non-fatal log. Use `--embedding-timeout` to bound only query embedding acquisition; it is not a wall-clock limit for the entire search process. `--latency-budget` remains a deprecated alias.

Unknown flags are rejected by subcommand. If a command exits with `Unknown option`, fix the flag instead of assuming the search ran with that constraint.

### `sensegrep semantic-kinds` — List framework-aware kinds

```bash
sensegrep semantic-kinds
sensegrep semantic-kinds --json
```

Common values include `convexQuery`, `convexMutation`, `convexAction`,
`convexInternalQuery`, `convexInternalMutation`, `convexInternalAction`,
`convexHttpAction`, `routeHandler`, `reactComponent`, `reactHook`, and
`wrappedFunction`.

Aliases include `convexPrivateQuery`, `convexPrivateMutation`, and `convexPrivateAction`.
Use wildcards for families:

```bash
sensegrep search "backend writes" --semantic-kind convex*
```

### `sensegrep index` — Index a project

Language detection is **automatic** — sensegrep detects TypeScript, JavaScript, Python, Java, and Vue on its own. **Never specify language when indexing.**

```bash
sensegrep index                  # fast, only changed files — use by default (incremental)
sensegrep index --full           # rebuild from scratch — only if index is corrupted or stale
sensegrep index --no-watch       # index once and exit — use in automation
sensegrep index --full --no-watch --timeout 5m --log-format jsonl
sensegrep index --dry-run --no-watch --json # local plan; no embedding calls
sensegrep index --full --no-watch            # resumes matching interrupted staging
sensegrep index --full --no-resume --no-watch # discard interrupted staging
sensegrep status                 # fast metadata-only stats; does not scan freshness
sensegrep status --verify        # compute changed/missing/removed freshness
sensegrep status --verbose       # freshness plus changedFiles/missingFiles/removedFiles
sensegrep index migrate --no-watch # atomic rebuild when schemaCompatible=false
sensegrep verify --strict        # non-zero exit unless index is fresh and internally consistent
sensegrep selftest --strict      # CLI/core health check without remote embedding calls
```

Search scores are metric-aware. New indexes use cosine distance explicitly and JSON results
include `score`, `rawDistance`, and `distanceMetric`. After upgrading across scoring/index
metadata changes, prefer `sensegrep index --full --no-watch`.

`sensegrep index` reports phases (`scan`, `parse`, `embed`, `persist`, `complete`) on stderr.
Use `--timeout <duration>` to budget the whole command, including lock wait. Bare numeric
timeouts are seconds; suffixes `ms`, `s`, and `m` are supported. `--max-files <n>` is useful
for smoke tests.

Changed files reuse vectors for content-identical chunks. Full indexing checkpoints its staging table and skips IDs already persisted after an interruption. Progress exposes embedded/reused/persisted chunks, estimated tokens/requests, elapsed time, and ETA.

### Benchmark and named profiles

Benchmarking calls the configured provider and may incur cost. It recommends concurrency but does not rewrite saved config:

```bash
sensegrep benchmark --concurrency 1,2,4 --samples 16 --json
sensegrep index --profile fast --no-watch
sensegrep profiles --root . --json
sensegrep search "request routing" --profile fast
```

`sensegrep verify --strict` enforces:

```text
indexed=true
expectedChunks == actualChunks
changed=0
missing=0
removed=0
isStale=false
```

Use `sensegrep selftest --strict --json` when checking whether the installed CLI and current
project index are healthy. Add `--deep` only when remote embeddings are configured and you
want to exercise search/duplicate JSON shape too.

## How the Search Pipeline Works

```
query + structural filters
        ↓
  exact symbol lookup for identifier queries
        ↓
  vector similarity + lexical retrieval (hybrid rank fusion)
        ↓
  optional deterministic rerank + pattern post-filter
        ↓
  dedup + diversify (--max-per-file, --max-per-symbol)
        ↓
  tree-shaking (collapse irrelevant regions, show matched symbol + context)
        ↓
  optional token-budget selection → final output
```

### 1. Structural filters — narrow the candidate pool (before ranking)

Applied at the vector store level, before embedding search:

- `--type` — `function | class | method | type | variable | enum | module`
- `--exported`, `--async`, `--static`, `--abstract` — boolean shape constraints
- `--language` — when the codebase is mixed and you need only one language
- `--parent` — narrow to a specific class or parent scope
- `--decorator` — filter by decorator name (`@route`, `@dataclass`, etc.)
- `--imports` — only files that import a given module
- `--has-docs` — require or exclude docstrings
- `--min-complexity` / `--max-complexity` — target simple helpers or complex business logic
- `--include` — file glob include filter (e.g. `packages/core/**/*.ts`). Prefer forward slashes in patterns, especially on Windows.
- `--exclude` — file glob exclude filter (e.g. `*.md`, `docs/**`)

`--parent` and `--imports` are useful narrowing filters, not proof-grade AST audits. Use `sensegrep literal` for exhaustive textual evidence and compiler/AST tooling when semantic relationships require language-level proof.

If file filters match no indexed files, Sensegrep returns zero results with a structured
`warnings[]` entry such as `No indexed files matched the file filters (...)`. Treat that
as a scope/glob problem, not as proof that the symbol or behavior does not exist.

### 2. `--pattern` — ripgrep regex post-filter (after semantic search)

`--pattern` anchors semantic results but remains non-exhaustive and returns `retrieval.exhaustive=false`. Use `sensegrep literal` for proof that every textual occurrence was considered.

```bash
# Find auth functions that specifically call jwt.verify
sensegrep search "token validation" --type function --pattern "jwt\.verify"

# Find rate limit handling that actually uses 429
sensegrep search "HTTP error response handling" --pattern "429|RateLimitError|Retry-After"

# Find cache code that does deletion or eviction
sensegrep search "cache invalidation" --type function --pattern "delete|evict|expire|clear"
```

### 3. Tree-shaking — how to get cleaner output

Tree-shaking collapses regions not relevant to your query. The more focused the search, the better the collapse:

- **Add `--type`** — results align to symbol boundaries; everything around them gets collapsed
- **Use `--include` or `--exclude`** — removes noise files entirely
- **Raise `--min-score`** — eliminates low-confidence results; surrounding code gets collapsed more aggressively
- **Lower `--max-per-file`** — prevents overlapping results from blocking contiguous collapse
- **Combine query + `--pattern`** — anchors result to a specific call site
- **Use `--no-shake`** — when a short or ambiguous query finds the right file but the important symbol is hidden behind collapsed output

```bash
# Broad — large uncollapsed blocks
sensegrep search "caching"

# Focused — tree-shaking collapses everything except the relevant function
sensegrep search "cache invalidation logic" \
  --type function \
  --exclude "*.md" \
  --pattern "delete|evict|expire" \
  --max-per-file 1 \
  --min-score 0.4
```

## Common Workflows

**Codebase onboarding:**
```bash
sensegrep survey "request lifecycle and middleware" --limit 4 --per-group 2
sensegrep search "request lifecycle and middleware" --limit 20 --max-per-file 2
sensegrep search "authentication and authorization" --type function --exported true --limit 20
```

**Break a broad domain into subthemes:**
```bash
sensegrep cluster "checkout payment order cart" --limit 4 --per-cluster 2
sensegrep cluster "price list commission ncm uf packaging" --language java --include "backend-api/**/*.java"
```

**Find refactoring candidates:**
```bash
sensegrep search "complex business logic" --type function --min-complexity 10 --has-docs false
sensegrep detect-duplicates --cross-file-only --only-exported --show-code --threshold 0.85 --max-candidates 1500
```

**Automated consumption:**
```bash
sensegrep search "bad signature rate limiting" --type function --json
sensegrep context "authentication request flow" --max-tokens 8000 --json
sensegrep audit "regression risks" --base origin/main --json
sensegrep survey "notifications resend email delivery" --json
sensegrep cluster "calendar sync webhook retry idempotency" --json
sensegrep impact updateUser --depth 3 --json
```

Use `results`, `groups`, `clusters`, or graph fields from JSON output. `output` remains for humans and backward compatibility.

**Audit async error paths:**
```bash
sensegrep search "error handling" --type function --async --min-complexity 4
```

**Scope to a class or module:**
```bash
sensegrep search "validation logic" --parent UserService
sensegrep search "route handler" --decorator "@route" --type function
```

**Pinpoint a specific call site (query + pattern):**
```bash
sensegrep search "database transaction" --type function --pattern "BEGIN|COMMIT|ROLLBACK"
sensegrep search "rate limiting" --pattern "429|RateLimitError|retry"
sensegrep search "token refresh flow" --async --pattern "refresh_token|refreshToken"
```

**Python-specific:**
```bash
sensegrep search "data model" --variant dataclass --language python
sensegrep search "async context manager" --variant generator --async --language python
```

**Java / Vue-specific:**
```bash
sensegrep search "order service orchestration" --language java --type class
sensegrep search "checkout page state and composables" --language vue --include "frontend-store/**/*.vue"
```
