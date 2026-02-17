# CLI Reference

## Installation

```bash
npm install -g @sensegrep/cli
```

## Commands

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
| `--languages <list>` | Languages to index (comma-separated) |

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
| `--include <glob>` | File glob filter (e.g. `src/**/*.ts`) |
| `--json` | Output as JSON |

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
| `--embed-model <name>` | Override embedding model |
| `--embed-dim <n>` | Override embedding dimension |
| `--rerank-model <name>` | Override reranker model |
| `--device <name>` | `cpu`, `cuda`, `webgpu`, `wasm` |
| `--provider <name>` | `local`, `gemini` |
| `--rerank` / `--no-rerank` | Enable/disable cross-encoder reranking |

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
| `--json` | Output as JSON |

### `sensegrep verify`

Verify index integrity (hash-only check).

```bash
sensegrep verify [--root <dir>]
```

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

# Index and keep watching
sensegrep index --root . --watch

# Check if index is up to date
sensegrep index --root . --verify
```
