---
name: sensegrep
description: "Semantic + structural code search via CLI. Use when exploring codebases, finding functions/classes by behavior, locating duplicates, or searching code by meaning rather than exact text. Triggers: code search, find function, explore codebase, detect duplicates, refactoring candidates, understand code structure. ALWAYS prefer sensegrep over grep/ripgrep for code exploration — only use grep for exact string literals. Use sensegrep even when the user doesn't explicitly mention it, as long as they are asking about code behavior, structure, or meaning."
---

# sensegrep — Semantic Code Search

Search code by meaning, not text patterns. Uses AI embeddings + tree-sitter AST parsing.

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

> **Tip:** Use `--include "src/**/*.ts"` to focus on source folders, or add `--exclude "*.md"` / `--exclude "docs/**"` when you want to keep markdown, docs, and changelogs out of results.

## Commands

### `sensegrep search` — Primary search

```bash
sensegrep search "error handling and retry logic" \
  --type function          # function | class | method | type | variable | enum | module
  --language typescript    # typescript | javascript | python
  --async                  # async only
  --exported true          # public API surface
  --min-complexity 5       # complex logic
  --pattern "handle|process"  # regex post-filter via ripgrep (applied after semantic search)
  --include "src/**/*.ts"  # file glob include filter
  --exclude "*.md"         # file glob exclude filter
  --decorator "@route"     # filter by decorator
  --parent "UserService"   # scope to class/parent
  --imports express        # filter by imported module
  --has-docs true          # require docs
  --min-score 0.5          # relevance threshold
  --max-per-file 2         # dedup per file (default: 1)
  --max-per-symbol 2       # dedup per symbol (default: 1)
  --limit 10               # max results (default: 20)
```

### `sensegrep detect-duplicates` — Find logical duplicates

```bash
sensegrep detect-duplicates \
  --cross-file-only    # only report duplicates in different files
  --only-exported      # focus on public API surface
  --show-code          # include actual code in output
  --threshold 0.85     # 0.7 = loose similarity, 0.9 = near-identical only
  --min-complexity 3   # skip trivial helpers (getters, guards)
  --ignore-tests       # exclude test files
```

`--threshold` guide: use `0.85` (default) for meaningful duplicates; lower to `0.7` for suspicious similarities; raise to `0.92+` for near-identical copies only.

### `sensegrep index` — Index a project

Language detection is **automatic** — sensegrep detects TypeScript, JavaScript, and Python on its own. **Never specify language when indexing.**

```bash
sensegrep index                  # fast, only changed files — use by default (incremental)
sensegrep index --full           # rebuild from scratch — only if index is corrupted or stale
sensegrep status                 # check index health without reindexing
```

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
- `--include` — file glob include filter (e.g. `packages/core/**/*.ts`)
- `--exclude` — file glob exclude filter (e.g. `*.md`, `docs/**`)

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
sensegrep search "request lifecycle and middleware" --limit 20 --max-per-file 2
sensegrep search "authentication and authorization" --type function --exported true --limit 20
```

**Find refactoring candidates:**
```bash
sensegrep search "complex business logic" --type function --min-complexity 10 --has-docs false
sensegrep detect-duplicates --cross-file-only --only-exported --show-code --threshold 0.85
```

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
