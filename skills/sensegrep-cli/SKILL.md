---
name: sensegrep-cli
description: "Semantic + structural code search via the sensegrep CLI (no MCP server required). Use when exploring codebases, finding functions/classes by behavior, locating duplicates, or searching code by meaning rather than exact text — by running `sensegrep` shell commands. Triggers: code search, find function, explore codebase, detect duplicates, refactoring candidates, understand code structure. ALWAYS prefer sensegrep over grep/ripgrep for code exploration — only use grep for exact string literals. Use sensegrep even when the user doesn't explicitly mention it, as long as they are asking about code behavior, structure, or meaning."
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

Add `--json` to any `search`, `survey`, `cluster`, or `detect-duplicates` command to get
machine-readable output that is easy to parse programmatically. When `--json` is active,
stdout is reserved for JSON; human progress and warnings go to stderr.

Use `sensegrep --version` to confirm the installed CLI version.

## When to Use

- **sensegrep** (95% of searches): Finding functions/classes by behavior, exploring structure, semantic queries, multi-criteria searches
- **grep** (5%): ONLY exact string literals — "TODO:", "FIXME:", specific variable names

## Recommended Defaults

Start with these defaults and adjust based on what you find:

| Goal | `--limit` | `--max-per-file` | Notes |
|---|---|---|---|
| Focused search (know what you want) | 10 (default) | 1 | Tight, clean tree-shaking output |
| General exploration | 20 | 2 | Balanced — visibly better file coverage than limit=10 |
| Broad discovery (large codebase) | 20 | 3 | Diminishing returns beyond 3; max-per-file=5 rarely adds value |

> When `--pattern` is set, sensegrep internally fetches `limit × 3` candidates before filtering — so the default limit=10 is already enough. Don't inflate `--limit` when using `--pattern`; the pattern does the filtering.

> **Tip:** Use `--include "src/**/*.ts"` to focus on source folders, or add `--exclude "*.md"` / `--exclude "docs/**"` when you want to keep markdown, docs, and changelogs out of results. On Windows, prefer forward slashes in globs (`src/**/*.ts`), though backslash-based indexed paths are now normalized automatically.

> **Identifier queries:** If the query looks like a symbol or framework API (`defineNuxtRouteMiddleware`, `defineStore`, `OrderServiceImpl`), sensegrep now auto-adds a literal fallback on top of semantic search. You usually do **not** need `--pattern` for these exact identifier lookups anymore.

> **Subdirectory roots:** If the repo root was indexed and you run `sensegrep` with `--root` pointing at a subdirectory, Sensegrep reuses the nearest indexed parent and scopes the query to that subdirectory. You no longer need to reindex every subfolder separately.

> **JSON output:** `--json` returns structured data plus the human-readable `output`: `search` returns `results`, `survey` returns `groups`, and `cluster` returns `clusters`. Prefer these fields for automation instead of parsing Markdown text.

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
  --semantic-kind convexMutation # framework-aware kind; run sensegrep semantic-kinds
  --explain-filters        # include whyMatched/filterMatches in JSON
  --strict-parent          # strict indexed parent metadata validation
  --strict-imports         # strict AST import metadata validation
  --has-docs true          # require docs
  --min-score 0.5          # relevance threshold
  --max-per-file 2         # dedup per file (default: 2)
  --max-per-symbol 2       # dedup per symbol (default: 2)
  --limit 10               # max results (default: 10)
  --json                   # structured results + text output
```

`--parent` matches parent/class scope by containment, so partial class names are acceptable. `--imports` tries package-name variants (`@scope/pkg`, `scope/pkg`, `pkg`) to reduce false misses in scoped packages.

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
  --ignore-tests       # exclude test files
```

`--threshold` guide: use `0.85` (default) for meaningful duplicates; lower to `0.7` for suspicious similarities; raise to `0.92+` for near-identical copies only.

For broad monorepos, start with `--include`, `--language`, `--min-lines`, or `--min-complexity` before raising `--max-candidates`. If the candidate set is larger than the cap, Sensegrep truncates explicitly and reports `summary.truncated`, `summary.candidates`, and `summary.analyzedCandidates` in JSON.

With `--json`, parse stdout directly. Use `--quiet --json` only when you also want to suppress stderr progress in interactive logs.

### `sensegrep semantic-kinds` — List framework-aware kinds

```bash
sensegrep semantic-kinds
sensegrep semantic-kinds --json
```

Common values include `convexQuery`, `convexMutation`, `convexAction`,
`convexInternalQuery`, `convexInternalMutation`, `convexInternalAction`,
`convexHttpAction`, `routeHandler`, `reactComponent`, `reactHook`, and
`wrappedFunction`.

### `sensegrep index` — Index a project

Language detection is **automatic** — sensegrep detects TypeScript, JavaScript, Python, Java, and Vue on its own. **Never specify language when indexing.**

```bash
sensegrep index                  # fast, only changed files — use by default (incremental)
sensegrep index --full           # rebuild from scratch — only if index is corrupted or stale
sensegrep index --no-watch       # index once and exit — use in automation
sensegrep status                 # check index health without reindexing
```

Search scores are metric-aware. New indexes use cosine distance explicitly and JSON results
include `score`, `rawDistance`, and `distanceMetric`. After upgrading across scoring/index
metadata changes, prefer `sensegrep index --full --no-watch`.

## How the Search Pipeline Works

```
query + structural filters
        ↓
  vector similarity search (AI embeddings)
        ↓
  pattern (ripgrep post-filter — fetches limit×3 candidates internally to compensate)
        ↓
  dedup + diversify (--max-per-file, --max-per-symbol)
        ↓
  tree-shaking (collapse irrelevant regions, show matched symbol + context)
        ↓
  final output
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

`--parent` and `--imports` are useful narrowing filters, not proof-grade AST audits. If a query must exhaustively prove every import or parent relationship, combine Sensegrep with `rg`, TypeScript tooling, or AST tooling.

### 2. `--pattern` — ripgrep regex post-filter (after semantic search)

Ripgrep runs on result files after semantic ranking. Only chunks where the regex matches are kept. Use `--pattern` when you need to guarantee a specific identifier, call, or token appears. Keep `--limit` at the default — the pipeline already fetches `limit × 3` candidates internally before filtering, so raising limit adds little when pattern is set.

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
sensegrep survey "notifications resend email delivery" --json
sensegrep cluster "calendar sync webhook retry idempotency" --json
```

Use `results`, `groups`, or `clusters` from JSON output. `output` remains for humans and backward compatibility.

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
