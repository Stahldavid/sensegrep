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
| `--pattern <regex>` | Regex post-filter on results |
| `--limit <n>` | Max results (default: 20) |
| `--include <glob>` | File glob include filter (e.g. `src/**/*.ts`) |
| `--exclude <glob>` | File glob exclude filter (e.g. `*.md`, `docs/**`) |
| `--json` | Output as JSON |

JSON search results include `score`, `rawDistance`, and `distanceMetric`. New indexes use
cosine distance explicitly for stable scoring across embedding providers.

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
| `--strict-imports` | Mark import filtering as strict AST metadata validation |

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
| `--provider <name>` | `gemini`, `openai`, `bedrock` |
| `--rerank` / `--no-rerank` | Compatibility flag; remote-only mode keeps semantic ranking |

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
| `--normalize-identifiers` / `--no-normalize-identifiers` | Normalize identifiers (default: on) |
| `--rank-by-impact` / `--no-rank-by-impact` | Rank by impact score (default: on) |
| `--limit <n>` | Show top N results (default: 10) |
| `--show-code` | Display duplicate code |
| `--full-code` | Show full code (no truncation) |
| `--verbose` | Show detailed output |
| `--quiet` | Only show summary |
| `--json` | Output as pure stdout JSON; human progress/warnings are written to stderr |

Unknown flags are rejected per subcommand. This prevents accidental no-op options
in automated agent workflows.

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
semantic-kind registration, language detection, status, and index verification.
Use `--strict` to require a fresh healthy index. Use `--deep` to additionally run
remote-embedding search and duplicate-result JSON shape checks.

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
