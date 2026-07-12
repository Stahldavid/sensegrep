# CLI Reference

## Installation

```bash
npm install -g @sensegrep/cli
```

## Commands

### Global flags

```bash
sensegrep --help
sensegrep --version
```

### `sensegrep index`

Build or update the semantic index.

```bash
sensegrep index [options]
```

| Flag | Description |
|------|-------------|
| `--root <dir>` | Root directory (default: cwd) |
| `--full` | Force full reindex |
| `--incremental` | Incremental update (default) |
| `--verify` | Verify index first, skip if up to date |
| `--watch` | Keep running, reindex on changes (at most once/minute) |
| `--no-watch` | Exit after indexing; recommended for automation |
| `--timeout <duration>` | Abort index lock/scan/parse/embed/persist after a duration (`30s`, `5m`, or bare seconds) |
| `--max-files <n>` | Index at most N files for smoke tests or diagnostics |
| `--log-format jsonl` | Emit progress as JSON Lines on stderr |
| `--json` | Emit a single JSON payload on stdout; progress remains on stderr and watch is disabled |

Index progress is reported by phase: `scan`, `parse`, `embed`, `persist`, and
`complete`. Progress and warnings are always written to stderr when `--json` is
active, so stdout remains parseable.

### `sensegrep search`

Semantic + structural code search.

```bash
sensegrep search <query> [options]
```

**Search options:**

| Flag | Description |
|------|-------------|
| `--query <text>` | Query text (alternative to positional) |
| `--pattern <regex>` | Non-exhaustive regex post-filter on semantic results |
| `--limit <n>` | Max results (default: 20) |
| `--include <glob>` | File glob include filter (e.g. `src/**/*.ts`) |
| `--exclude <glob>` | File glob exclude filter (e.g. `*.md`, `docs/**`) |
| `--json` | Output as JSON |
| `--embedding-timeout <ms>` | Query embedding deadline before lexical fallback; does not cap total process time |
| `--latency-budget <ms>` | Deprecated alias for `--embedding-timeout` |
| `--hybrid-mode <mode>` | `adaptive` (default) or `parallel`; adaptive may skip lexical work for strong semantic evidence |

JSON is minified by default; use `--pretty` for human-readable indentation. Output projections:

| Detail | Contents |
|---|---|
| `minimal` | Envelope, sufficiency, locations, `score`, `rankScore`, and `resultId` |
| `content` | Minimal plus code content |
| `diagnostic` | Ranking explanations, distances, timings, freshness, and index details |
| `full` | Internal structures and rendered output when requested |

`compact` remains an alias for `minimal`. Use `--diagnostic` as shorthand for
`--json-detail diagnostic`. New indexes use cosine distance explicitly; distance diagnostics
are emitted once requested rather than repeated in ordinary cards.

Minimal agent output retains `retrieval.actualMode`, `retrieval.universe`, `index`,
`budget`, and warnings. With `--explain-filters`, `whyMatched` and `filterMatches`
remain present even in `minimal` cards.

Semantic and lexical retrieval run concurrently. Lexical matches are mapped to indexed chunks
with one batched LanceDB read rather than one query per file. Query embeddings are cached
persistently by an opaque provider/model/dimension/task/query hash; diagnostic metrics expose
`queryEmbeddingCacheHit` and `adaptiveLexicalSkipped`.

**Symbol filters:**

| Flag | Description |
|------|-------------|
| `--type <type>` | `function`, `class`, `method`, `type`, `variable`, `enum`, `module` |
| `--variant <name>` | Language-specific variant (`interface`, `dataclass`, `protocol`, etc.) |
| `--decorator <name>` | Filter by decorator (`@property`, `@dataclass`, etc.) |
| `--symbol <name>` | Filter by symbol name |
| `--name <name>` | Alias for `--symbol` |
| `--exported` | Only exported symbols |
| `--async` | Only async functions/methods |
| `--static` | Only static methods |
| `--abstract` | Only abstract classes/methods |
| `--language <lang>` | `typescript`, `javascript`, `python` (comma-separated) |
| `--parent <name>` | Parent scope/class name |
| `--imports <name>` | Filter by imported module |
| `--semantic-kind <kind>` | Framework-aware kind (`convexMutation`, `convexAction`, `reactComponent`, etc.); aliases and `*` wildcards are supported |
| `--explain-filters` | Include `whyMatched` and `filterMatches` in JSON results |
| `--strict-parent` | Mark parent filtering as strict indexed metadata validation |
| `--strict-imports` | Require an exact normalized module specifier such as `convex/react` |

**Quality filters:**

| Flag | Description |
|------|-------------|
| `--min-complexity <n>` | Minimum cyclomatic complexity |
| `--max-complexity <n>` | Maximum cyclomatic complexity |
| `--has-docs <bool>` | Require documentation |
| `--min-score <n>` | Minimum relevance score (0-1) |
| `--max-per-file <n>` | Max results per file (default: 1) |
| `--max-per-symbol <n>` | Max results per symbol (default: 1) |

**Embedding overrides:**

| Flag | Description |
|------|-------------|
| `--embed-model <name>` | Override remote embedding model |
| `--embed-dim <n>` | Override embedding dimension |
| `--provider <name>` | `ollama`, `gemini`, `openai`, `bedrock` |
| `--rerank` / `--no-rerank` | Compatibility flag; remote-only mode keeps semantic ranking |

Changing provider, model, base URL, embedding dimension, local server pooling behavior, or task-prefix strategy requires a full reindex. Same-dimensional embeddings from different models are not interchangeable.

### `sensegrep literal`

Deterministic exhaustive search over indexed project files. It does not call the embedding provider.

```bash
sensegrep literal "X-Goog-Message-Number" --include "src/**" --json
sensegrep literal "retry|backoff" --regex --ignore-case --limit 200
```

JSON reports `totalMatches`, `returnedMatches`, `truncated`, and `exhaustive`. Omitting `--limit` returns every occurrence. Use `--pattern` to anchor semantic candidates; use `literal` when every occurrence matters.
`literal --filesystem` executes a direct ripgrep fast path and does not resolve the
semantic index or embedding configuration. `--max-output-bytes` limits the complete
serialized JSON payload, including envelope and escaping, rather than only match text.

### `sensegrep audit`

Build changed-file evidence under one global budget. Continuation batches contain compact,
deduplicated `resultId` cards; expand only selected cards with `sensegrep show`.

```bash
sensegrep audit "security regressions" --base origin/main \
  --require-coverage --continue-uncovered \
  --max-total-tokens 8000 --max-output-bytes 32000 --max-batches 8 --json
```

`--batch-tokens` is a strict per-batch ceiling; large files are split into stable line/offset cards.
Each batch exposes those ranges directly through `ranges`, in addition to `resultIds`.
`budget` reports `retrievalTokens`, `contextTokens`, `attemptedTokens`, and
`actualEmittedTokens` separately. `attemptedOutputBytes` describes the pre-serialization
evidence while `actualOutputBytes` is measured from the final CLI JSON.
When a limit prevents complete changed-file coverage, `status` is `incomplete` and
`coverage.truncationReasons` identifies the global limit that was reached.

### `sensegrep detect-duplicates`

Find logical code duplicates.

```bash
sensegrep detect-duplicates [options]
```

| Flag | Description |
|------|-------------|
| `--root <dir>` | Root directory (default: cwd) |
| `--threshold <n>` | Minimum similarity 0.0-1.0 (default: 0.85) |
| `--scope <type>` | `function`, `method`, or `all` (default: `function,method`) |
| `--language <lang>` | Filter by language |
| `--include <glob>` | Include only matching indexed file paths |
| `--exclude <glob>` | Exclude matching indexed file paths |
| `--cross-language` | Detect across languages |
| `--ignore-tests` | Exclude test files |
| `--cross-file-only` | Only cross-file duplicates |
| `--only-exported` | Only exported symbols |
| `--exclude-pattern <regex>` | Exclude matching symbols |
| `--min-lines <n>` | Minimum lines (default: 10) |
| `--min-complexity <n>` | Minimum complexity (default: 0) |
| `--max-candidates <n>` | Maximum candidate set before explicit truncation |
| `--timeout <duration>` | Return partial results after a wall-clock deadline (`30s`, `5m`) |
| `--resume-cursor <n>` | Continue candidate analysis from `summary.resumeCursor` |
| `--normalize-identifiers` / `--no-normalize-identifiers` | Normalize identifiers (default: on) |
| `--rank-by-impact` / `--no-rank-by-impact` | Rank by impact score (default: on) |
| `--limit <n>` | Show top N results (default: 10) |

JSON duplicate results always include `schemaVersion`, `command`, and `status`.
Duplicate instances omit source code unless `--show-code` is explicitly supplied.
Minimal search cards use canonical location fields while diagnostic-only metadata stays opt-in.
| `--show-code` | Display duplicate code |
| `--full-code` | Show full code (no truncation) |
| `--verbose` | Show detailed output |
| `--quiet` | Only show summary |
| `--json` | Output as pure stdout JSON; human progress/warnings are written to stderr |

Unknown flags are rejected per subcommand. This prevents accidental no-op options
in automated agent workflows.

With `--json`, argument failures are also emitted as a single JSON object on stdout
with `status: "error"`, `errorInfo.code`, `phase`, and `retryable`; invalid arguments
exit with code 2. Stderr remains empty unless non-JSON logging was explicitly requested.

### `sensegrep survey` and `sensegrep cluster`

JSON CLI and MCP calls default to `summary`, avoiding representative source payloads.
Use `--json-detail representatives` when sample cards are needed, or `full` for
diagnostics. Semantic-provider fallback is always reflected by
`retrieval.actualMode: "lexical-fallback"` and a warning.

### `sensegrep show`

`show` reads the selected source location directly and does not open the vector table.
Its freshness is explicitly target-scoped as `index.targetFresh`; it does not claim
that the entire index is fresh. `expand` additionally loads graph evidence.

### `sensegrep verify`

Verify index integrity (hash-only check).

```bash
sensegrep verify [--root <dir>] [--strict] [--json]
```

Use `--strict` in automation. It exits non-zero unless all index invariants hold:

```text
indexed=true
expectedChunks == actualChunks
changed=0
missing=0
removed=0
isStale=false
```

With `--json`, stdout is a single JSON payload; human summaries are not mixed into
stdout.

### `sensegrep status`

Show index metadata as JSON.

```bash
sensegrep status [--root <dir>]
```

### `sensegrep languages`

Manage language support.

```bash
sensegrep languages              # List supported languages
sensegrep languages --detect     # Detect project languages
sensegrep languages --variants   # Show all variants by language
```

### `sensegrep semantic-kinds`

List framework-aware semantic kind filters.

```bash
sensegrep semantic-kinds
sensegrep semantic-kinds --json
```

Current built-in values include `convexQuery`, `convexMutation`, `convexAction`,
`convexInternalQuery`, `convexInternalMutation`, `convexInternalAction`,
`convexHttpAction`, `routeHandler`, `reactComponent`, `reactHook`, and
`wrappedFunction`.

Aliases include `convexPrivateQuery`, `convexPrivateMutation`, and
`convexPrivateAction`, which resolve to their `convexInternal*` forms. Wildcards
are supported:

```bash
sensegrep search "backend write operations" --semantic-kind convex*
```

### `sensegrep selftest`

Run a CLI/core health check.

```bash
sensegrep selftest --root .
sensegrep selftest --root . --strict --json
sensegrep selftest --root . --deep
```

Default selftest avoids remote embedding calls. It checks CLI version discovery,
semantic-kind registration, embedding provider/model/dimension configuration,
language detection, status, and index verification. When credentials are missing,
it prints the exact environment variables to set without revealing any secret
values. Use `--strict` to require a fresh healthy index. Use `--deep` to
additionally run remote-embedding search and duplicate-result JSON shape checks.

## Examples

```bash
# Basic semantic search
sensegrep search "authentication and token validation"

# Find exported async functions with high complexity
sensegrep search "data processing" --type function --exported --async --min-complexity 5

# Find Python dataclasses
sensegrep search "user model" --type class --variant dataclass --language python

# Search with regex post-filter
sensegrep search "database" --pattern "pool|connection"

# Find duplicates, show code, only cross-file
sensegrep detect-duplicates --cross-file-only --show-code --only-exported

# List framework-aware semantic kinds
sensegrep semantic-kinds --json

# Index and keep watching
sensegrep index --root . --watch

# Check if index is up to date
sensegrep index --root . --verify

# Strict index invariant for automation
sensegrep verify --strict --json

# Full rebuild with observable progress and a command budget
sensegrep index --full --no-watch --timeout 5m --log-format jsonl

# CLI health check
sensegrep selftest --strict --json
```
