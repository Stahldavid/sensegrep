---
name: sensegrep
description: "Semantic + structural code search via MCP. Use when exploring codebases, finding functions/classes by behavior, locating duplicates, or searching code by meaning rather than exact text. Triggers: code search, find function, explore codebase, detect duplicates, refactoring candidates, understand code structure. ALWAYS prefer sensegrep over grep/ripgrep for code exploration — only use grep for exact string literals. Use sensegrep even when the user doesn't explicitly mention it, as long as they are asking about code behavior, structure, or meaning."
---

# sensegrep — Semantic Code Search

Search code by meaning, not text patterns. Uses AI embeddings + tree-sitter AST parsing.

## When to Use

- **sensegrep** (95% of searches): Finding functions/classes by behavior, exploring structure, semantic queries, multi-criteria searches
- **grep** (5%): ONLY exact string literals — "TODO:", "FIXME:", specific variable names

## Recommended Defaults

Start with these defaults and adjust based on what you find:

| Goal | `limit` | `maxPerFile` | Notes |
|---|---|---|---|
| Focused search (know what you want) | 10 (default) | 1 | Tight, clean tree-shaking output |
| General exploration | 20 | 2 | Balanced — visibly better file coverage than limit=10 |
| Broad discovery (large codebase) | 20 | 3 | Diminishing returns beyond 3; maxPerFile=5 rarely adds value |

> When `pattern` is set, sensegrep internally fetches `limit × 3` candidates before filtering — so the default limit=10 is already enough. Don't inflate `limit` when using `pattern`; the pattern does the filtering.

> **Tip:** Use `include: "src/**/*.ts"` to focus on source folders, or add `exclude: "*.md"` / `exclude: "docs/**"` when you want to keep markdown, docs, and changelogs out of results.

## Tools Available

### `sensegrep_search` — Primary search

```
sensegrep_search({
  query: "error handling and retry logic",  // natural language or code snippet
  symbolType: "function",       // function | class | method | type | variable | enum | module
  language: "typescript",       // typescript | javascript | python
  isAsync: true,                // async only
  isExported: true,             // public API surface
  minComplexity: 5,             // complex logic
  pattern: "handle|process",    // regex post-filter via ripgrep (applied after semantic search)
  include: "src/**/*.ts",       // file glob include filter
  exclude: "*.md",              // file glob exclude filter
  decorator: "@route",          // filter by decorator
  parentScope: "UserService",   // scope to class/parent
  imports: "express",           // filter by imported module
  hasDocumentation: true,       // require docs
  minScore: 0.5,                // relevance threshold
  maxPerFile: 2,                // dedup per file (default: 2)
  maxPerSymbol: 2,              // dedup per symbol (default: 2)
  limit: 10                     // max results (default: 10)
})
```

### `sensegrep_detect_duplicates` — Find logical duplicates

```
sensegrep_detect_duplicates({
  crossFileOnly: true,       // only report duplicates in different files
  onlyExported: true,        // focus on public API surface
  showCode: true,            // include actual code in output
  threshold: 0.85,           // 0.7 = loose similarity, 0.9 = near-identical only
  minComplexity: 3,          // skip trivial helpers (getters, guards)
  ignoreTests: true          // exclude test files
})
```

`threshold` guide: use `0.85` (default) for meaningful duplicates; lower to `0.7` for suspicious similarities; raise to `0.92+` for near-identical copies only.

### `sensegrep_index` — Index a project

Language detection is **automatic** — sensegrep detects TypeScript, JavaScript, and Python on its own. **Never specify language when indexing.**

```
sensegrep_index({ action: "index", mode: "incremental" })  // fast, only changed files — use by default
sensegrep_index({ action: "index", mode: "full" })         // rebuild from scratch — only if index is corrupted or stale
sensegrep_index({ action: "stats" })                        // check index health without reindexing
```

## How the Search Pipeline Works

```
query + structural filters
        ↓
  vector similarity search (AI embeddings)
        ↓
  pattern (ripgrep post-filter — fetches limit×3 candidates internally to compensate)
        ↓
  dedup + diversify (maxPerFile, maxPerSymbol)
        ↓
  tree-shaking (collapse irrelevant regions, show matched symbol + context)
        ↓
  final output
```

### 1. Structural filters — narrow the candidate pool (before ranking)

Applied at the vector store level, before embedding search:

- `symbolType` — `function | class | method | type | variable | enum | module`
- `isExported`, `isAsync`, `isStatic`, `isAbstract` — boolean shape constraints
- `language` — when the codebase is mixed and you need only one language
- `parentScope` — narrow to a specific class or parent scope
- `decorator` — filter by decorator name (`@route`, `@dataclass`, etc.)
- `imports` — only files that import a given module
- `hasDocumentation` — require or exclude docstrings
- `minComplexity` / `maxComplexity` — target simple helpers or complex business logic
- `include` — file glob include filter (e.g. `packages/core/**/*.ts`)
- `exclude` — file glob exclude filter (e.g. `*.md`, `docs/**`)

### 2. `pattern` — ripgrep regex post-filter (after semantic search)

Ripgrep runs on result files after semantic ranking. Only chunks where the regex matches are kept. Use `pattern` when you need to guarantee a specific identifier, call, or token appears. Keep `limit` at the default (10) — the pipeline already fetches `limit × 3` candidates internally before filtering, so raising limit adds little when pattern is set.

```
// Find auth functions that specifically call jwt.verify
sensegrep_search({ query: "token validation", symbolType: "function", pattern: "jwt\\.verify" })

// Find rate limit handling that actually uses 429
sensegrep_search({ query: "HTTP error response handling", pattern: "429|RateLimitError|Retry-After" })

// Find cache code that does deletion or eviction
sensegrep_search({ query: "cache invalidation", symbolType: "function", pattern: "delete|evict|expire|clear" })
```

### 3. Tree-shaking — how to get cleaner output

Tree-shaking collapses regions not relevant to your query. The more focused the search, the better the collapse:

- **Add `symbolType`** — results align to symbol boundaries; everything around them gets collapsed
- **Use `include` or `exclude`** — removes noise files entirely
- **Raise `minScore`** — eliminates low-confidence results; surrounding code gets collapsed more aggressively
- **Lower `maxPerFile`** — prevents overlapping results from blocking contiguous collapse
- **Combine `query` + `pattern`** — anchors result to a specific call site

```
// Broad — large uncollapsed blocks
sensegrep_search({ query: "caching" })

// Focused — tree-shaking collapses everything except the relevant function
sensegrep_search({
  query: "cache invalidation logic",
  symbolType: "function",
  exclude: "*.md",
  pattern: "delete|evict|expire",
  maxPerFile: 1,
  minScore: 0.4
})
```

## Common Workflows

**Codebase onboarding:**
```
sensegrep_search({ query: "request lifecycle and middleware", limit: 20, maxPerFile: 2 })
sensegrep_search({ query: "authentication and authorization", symbolType: "function", isExported: true, limit: 20 })
```

**Find refactoring candidates:**
```
sensegrep_search({ query: "complex business logic", symbolType: "function", minComplexity: 10, hasDocumentation: false })
sensegrep_detect_duplicates({ crossFileOnly: true, onlyExported: true, showCode: true, threshold: 0.85 })
```

**Audit async error paths:**
```
sensegrep_search({ query: "error handling", symbolType: "function", isAsync: true, minComplexity: 4 })
```

**Scope to a class or module:**
```
sensegrep_search({ query: "validation logic", parentScope: "UserService" })
sensegrep_search({ query: "route handler", decorator: "@route", symbolType: "function" })
```

**Pinpoint a specific call site (query + pattern):**
```
sensegrep_search({ query: "database transaction", symbolType: "function", pattern: "BEGIN|COMMIT|ROLLBACK" })
sensegrep_search({ query: "rate limiting", pattern: "429|RateLimitError|retry" })
sensegrep_search({ query: "token refresh flow", isAsync: true, pattern: "refresh_token|refreshToken" })
```

**Python-specific:**
```
sensegrep_search({ query: "data model", variant: "dataclass", language: "python" })
sensegrep_search({ query: "async context manager", variant: "generator", isAsync: true, language: "python" })
```
