---
name: sensegrep
description: "Semantic, structural, and exhaustive literal code evidence via MCP. Prefer sensegrep_search for meaning and sensegrep_literal for exact strings; use raw grep only as a fallback."
---

# sensegrep — Semantic Code Search

Search code by meaning, not text patterns. Uses AI embeddings + tree-sitter AST parsing.

## When to Use

- **sensegrep_search**: behavior, structure, semantic queries, and multi-criteria discovery
- **sensegrep_literal**: exact strings and regex proof, including filesystem mode
- **grep/ripgrep**: fallback only

## Recommended Defaults

Start with these defaults and adjust based on what you find:

| Goal | `limit` | `maxPerFile` | Notes |
|---|---|---|---|
| Focused search (know what you want) | 10 (default) | 1 | Tight, clean tree-shaking output |
| General exploration | 20 | 2 | Balanced — visibly better file coverage than limit=10 |
| Broad discovery (large codebase) | 20 | 3 | Diminishing returns beyond 3; maxPerFile=5 rarely adds value |

> When `pattern` is set, sensegrep internally fetches `limit × 3` candidates before filtering — so the default limit=10 is already enough. Don't inflate `limit` when using `pattern`; the pattern does the filtering.

> **Tip:** Use `include: "src/**/*.ts"` to focus on source folders, or add `exclude: "*.md"` / `exclude: "docs/**"` when you want to keep markdown, docs, and changelogs out of results. On Windows, prefer forward slashes in globs (`src/**/*.ts`), though backslash-based indexed paths are now normalized automatically.

> **Identifier queries:** If the query looks like a symbol or framework API (`defineNuxtRouteMiddleware`, `defineStore`, `OrderServiceImpl`), sensegrep auto-adds exact/literal fallback on top of semantic search. For short identifiers such as `emit`, `run`, or `sync`, pass `exact: true`; it promotes exact symbol-name matches and can avoid a slow/weak semantic search.

> **Subdirectory roots:** If the repo root was indexed and a tool call uses `rootDir` pointing at a subdirectory, Sensegrep reuses the nearest indexed parent and scopes the query to that subdirectory. You no longer need to reindex every subfolder separately.

> **Structured output:** Search returns compact cards with `resultId` by default. Expand selected evidence with `sensegrep_show`; request `resultDetail: "content"` or `"full"` only when needed. Inspect `retrieval.actualMode`, universe, index, budget, and warnings before relying on evidence.

## Tools Available

### `sensegrep_search` — Primary search

```
sensegrep_search({
  query: "error handling and retry logic",  // natural language or code snippet
  symbolType: "function",       // function | class | method | type | variable | enum | module
  language: "typescript",       // typescript | javascript | python | java | vue
  isAsync: true,                // async only
  isExported: true,             // public API surface
  minComplexity: 5,             // complex logic
  pattern: "handle|process",    // regex post-filter via ripgrep (applied after semantic search)
  include: "src/**/*.ts",       // file glob include filter
  exclude: "*.md",              // file glob exclude filter
  decorator: "@route",          // filter by decorator
  parentScope: "UserService",   // scope to class/parent
  imports: "express",           // filter by imported module
  exact: true,                  // prefer exact symbol lookup for identifier queries
  semanticKind: "convexMutation", // framework-aware kind (Convex, React, route handlers)
  explainFilters: true,         // include whyMatched/filterMatches in structured output
  strictParent: true,           // strict indexed parent metadata validation
  strictImports: true,          // strict AST import metadata validation
  hasDocumentation: true,       // require docs
  minScore: 0.5,                // relevance threshold
  maxPerFile: 2,                // dedup per file (default: 2)
  maxPerSymbol: 2,              // dedup per symbol (default: 2)
  shake: false,                 // disable tree-shaking if collapsed output hides the target
  limit: 10                     // max results (default: 10)
})
```

### `sensegrep_survey` — Reading map for a theme

Use this when you want grouped reading domains instead of a flat result list.

```
sensegrep_survey({
  query: "authentication login token",
  language: "typescript",
  include: "frontend-admin/**/*.ts",
  limit: 4,
  perGroup: 2
})
```

Returns grouped, tree-shaken domains such as `middleware / guards`, `stores / state`, and `services / api`.

### `sensegrep_cluster` — Break a broad topic into subthemes

Use this when a theme is broad and you want coherent clusters instead of just top-N hits.

```
sensegrep_cluster({
  query: "price list commission ncm uf packaging",
  language: "java",
  include: "backend-api/**/*.java",
  limit: 4,
  perCluster: 2,
  clusterThreshold: 0.72
})
```

Returns cluster headings plus representative tree-shaken snippets using embeddings + AST metadata + path/import signals.

### `sensegrep_detect_duplicates` — Find logical duplicates

```
sensegrep_detect_duplicates({
  crossFileOnly: true,       // only report duplicates in different files
  onlyExported: true,        // focus on public API surface
  showCode: true,            // include actual code in output
  threshold: 0.85,           // 0.7 = loose similarity, 0.9 = near-identical only
  minComplexity: 3,          // skip trivial helpers (getters, guards)
  include: "src/**/*.ts",    // optional file glob include filter
  exclude: "*.test.ts",      // optional file glob exclude filter
  language: "typescript",    // optional language filter
  maxCandidates: 1500,       // cap broad scans; raise for deeper audits
  ignoreTests: true          // exclude test files
})
```

`threshold` guide: use `0.85` (default) for meaningful duplicates; lower to `0.7` for suspicious similarities; raise to `0.92+` for near-identical copies only.

For broad monorepos, start with `include`, `language`, `minLines`, or `minComplexity` before raising `maxCandidates`. If the candidate set is larger than the cap, Sensegrep truncates explicitly and reports `summary.truncated`, `summary.candidates`, and `summary.analyzedCandidates`.

### `sensegrep_index` — Index a project

Language detection is **automatic** — sensegrep detects TypeScript, JavaScript, Python, Java, and Vue on its own. **Never specify language when indexing.**

```
sensegrep_index({ action: "index", mode: "incremental" })  // fast, only changed files — use by default
sensegrep_index({ action: "index", mode: "full" })         // rebuild from scratch — only if index is corrupted or stale
sensegrep_index({ action: "stats" })                        // check index health without reindexing
```

Language inventory and variant listing are intentionally CLI-only to keep the MCP tool list small. If a user explicitly needs that inventory, suggest `sensegrep languages --detect` or `sensegrep languages --variants`.

## How the Search Pipeline Works

```
query + structural filters
        ↓
  exact symbol lookup for identifier queries
        ↓
  vector similarity search (AI embeddings, skipped when exact has a strong symbol hit)
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
- `include` — file glob include filter (e.g. `packages/core/**/*.ts`). Prefer forward slashes in patterns, especially on Windows.
- `exclude` — file glob exclude filter (e.g. `*.md`, `docs/**`)

`parentScope` matches parent/class scope by containment, so partial class names are acceptable. `imports` tries package-name variants (`@scope/pkg`, `scope/pkg`, `pkg`) to reduce false misses in scoped packages. Treat both as useful narrowing filters, not proof-grade AST audits; combine with `rg`, TypeScript tooling, or AST tooling when exhaustive proof is required.

If file filters match no indexed files, Sensegrep returns zero results with a structured
`warnings[]` entry such as `No indexed files matched the file filters (...)`. Fix the
scope/glob before concluding the code is absent.

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
- **Set `shake: false`** — when a short or ambiguous query finds the right file but the important symbol is hidden behind collapsed output

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
sensegrep_detect_duplicates({ crossFileOnly: true, onlyExported: true, showCode: true, threshold: 0.85, maxCandidates: 1500 })
```

**Automated consumption:**
```
sensegrep_search({ query: "bad signature rate limiting", symbolType: "function" })
sensegrep_survey({ query: "notifications resend email delivery" })
sensegrep_cluster({ query: "calendar sync webhook retry idempotency" })
```

Use `results`, `groups`, or `clusters` from `structuredContent`. `output` remains for humans and backward compatibility.

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

**Java / Vue-specific:**
```
sensegrep_search({ query: "order service orchestration", language: "java", symbolType: "class" })
sensegrep_search({ query: "checkout page state and composables", language: "vue", include: "frontend-store/**/*.vue" })
```
