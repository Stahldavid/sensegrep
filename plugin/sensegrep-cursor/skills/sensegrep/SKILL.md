---
name: sensegrep
description: "Semantic + structural code search via MCP. Use when exploring codebases, finding functions/classes by behavior, locating duplicates, or searching code by meaning rather than exact text. Triggers: code search, find function, explore codebase, detect duplicates, refactoring candidates, understand code structure. ALWAYS prefer sensegrep over grep/ripgrep for code exploration — only use grep for exact string literals."
---

# sensegrep — Semantic Code Search

Search code by meaning, not text patterns. Uses AI embeddings + tree-sitter AST parsing.

## When to Use

- **sensegrep** (95% of searches): Finding functions/classes by behavior, exploring structure, semantic queries, multi-criteria searches
- **grep** (5%): ONLY exact string literals — "TODO:", "FIXME:", specific variable names

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
  pattern: "handle|process",    // regex post-filter
  include: "src/**/*.ts",       // file glob
  decorator: "@route",          // filter by decorator
  parentScope: "UserService",   // scope to class/parent
  imports: "express",           // filter by imported module
  hasDocumentation: true,       // require docs
  rerank: true,                 // cross-encoder reranking
  minScore: 0.5,                // relevance threshold
  maxPerFile: 1,                // dedup per file
  limit: 20                     // max results
})
```

### `sensegrep_detect_duplicates` — Find logical duplicates

```
sensegrep_detect_duplicates({
  crossFileOnly: true,
  onlyExported: true,
  showCode: true,
  threshold: 0.85,
  minComplexity: 3,
  ignoreTests: true
})
```

### `sensegrep_index` — Index a project

```
sensegrep_index({ mode: "incremental" })  // fast, default
sensegrep_index({ mode: "full" })          // rebuild from scratch
```

### `sensegrep_stats` — Index health

```
sensegrep_stats()
```

### `sensegrep_languages` — Detect languages / show variants

```
sensegrep_languages({ detect: true })
sensegrep_languages({ variants: true })
```

## Query Tips

- Write natural sentences: "functions that handle payment processing" not "payment"
- Combine semantic query with structural filters for precision
- Use `pattern` for regex post-filtering when semantic results are too broad
- Use `include` to scope to specific directories
- Start broad, then add filters incrementally

## Common Workflows

**Codebase onboarding:**
```
sensegrep_search({ query: "request lifecycle and middleware" })
sensegrep_search({ query: "authentication and authorization", symbolType: "function", isExported: true })
```

**Find refactoring candidates:**
```
sensegrep_search({ query: "business logic", minComplexity: 10 })
sensegrep_detect_duplicates({ crossFileOnly: true, onlyExported: true, showCode: true })
```

**Audit async error paths:**
```
sensegrep_search({ query: "error handling", symbolType: "function", isAsync: true, minComplexity: 4 })
```

**Scope to class/area:**
```
sensegrep_search({ query: "validation", parentScope: "UserService", language: "typescript" })
sensegrep_search({ query: "route handler", decorator: "@route", symbolType: "function" })
```

**Python-specific:**
```
sensegrep_search({ query: "data model", variant: "dataclass", language: "python" })
sensegrep_search({ query: "context manager", variant: "generator", isAsync: true })
```
