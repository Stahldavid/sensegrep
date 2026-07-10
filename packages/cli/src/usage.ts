export const CLI_USAGE = `
sensegrep (CLI)

Usage:
  sensegrep index [--root <dir>] [--full|--incremental] [--verify|--check] [--no-watch] [--include-docs] [--include-config]
  sensegrep verify [--root <dir>] [--strict] [--json]
  sensegrep status [--root <dir>] [--verify|--verbose]
  sensegrep search <query...> [options]
  sensegrep literal <text-or-regex> [--regex] [--ignore-case] [options]
  sensegrep show <result-id> [--before <n>] [--after <n>]
  sensegrep expand <result-id> [--max-nodes <n>]
  sensegrep context <query...> [--max-tokens <n>] [options]
  sensegrep survey <query...> [options]
  sensegrep cluster <query...> [options]
  sensegrep detect-duplicates [--root <dir>] [options]
  sensegrep languages [--detect] [--variants] [--json]
  sensegrep semantic-kinds [--json]
  sensegrep selftest [--root <dir>] [--strict] [--deep] [--json]
  sensegrep investigate <query...> [--dry-run] [--max-tokens <n>]
  sensegrep eval <cases.yaml|cases.json> [--limit <n>]
  sensegrep daemon start|status|stop|endpoint
  sensegrep daemon call --tool search --arguments '{"query":"auth flow"}'

Search options:
  --query <text>            Query text (if not provided as positional)
  --pattern <regex>         Regex filter (post-filter)
  --limit <n>               Max results (default: 10)
  --include <glob>          File glob include filter (e.g. "src/**/*.ts")
  --exclude <glob>          File glob exclude filter (e.g. "*.md" or "docs/**")
  --type <symbolType>       function|class|method|type|variable|enum|module
  --variant <name>          Language-specific variant (interface, dataclass, protocol, etc.)
  --decorator <name>        Filter by decorator (@property, @dataclass, etc.)
  --symbol <name>           Filter by symbol name
  --name <name>             Alias for --symbol
  --exact                   Prefer exact symbol-name lookup for identifier queries
  --exported <true|false>   Only exported symbols
  --async                   Only async functions/methods
  --static                  Only static methods
  --abstract                Only abstract classes/methods
  --min-complexity <n>      Minimum cyclomatic complexity
  --max-complexity <n>      Maximum cyclomatic complexity
  --min-score <n>           Minimum relevance score 0-1
  --max-per-file <n>        Max results per file (default: 2)
  --max-per-symbol <n>      Max results per symbol (default: 2)
  --has-docs <true|false>   Require documentation
  --language <lang>         typescript|javascript|python|java|vue (comma-separated for multiple)
  --parent <name>           Parent scope/class name
  --imports <name>          Filter by imported module name
  --rerank <true|false>     Compatibility flag; semantic ranking is kept as-is
  --no-rerank               Disable reranking
  --hybrid <true|false>     Fuse lexical and vector retrieval (default: true)
  --no-hybrid               Disable lexical/vector fusion
  --max-tokens <n>          Limit estimated output tokens (context default: 12000)
  --latency-budget <ms>     Query embedding deadline (default: 15000ms)
  --purpose <mode>          understand|implement|review|test ranking preset
  --prefer-role <role>      Boost a file role (implementation, test, contract, etc.)
  --include-role <role>     Include only one file role
  --exclude-role <role>     Exclude one file role
  --json-detail <mode>      compact|content|full for search JSON (default: compact)
  --include-rendered-output Include rendered Markdown in JSON
  --dry-run                 Plan indexing and estimate embedding work without API calls
  --no-resume               Discard interrupted full-index staging data
  benchmark                 Measure embedding throughput and recommend concurrency
  audit <query>             Build review context restricted to Git changes
  literal <text|regex>      Exhaustive deterministic search without embeddings
  references <symbol>       Find indexed references to a symbol
  impact <symbol>           Traverse reverse references for change impact
  trace <from> <to>         Find a symbol-reference path
  profiles                  List side-by-side index profiles for this root
  --concurrency 1,2,4       Benchmark candidate concurrency levels
  --changed                 Restrict retrieval to Git-changed files
  --base <revision>         Base revision for --changed (default: HEAD)
  --require-coverage        Mark audit incomplete when any changed file is unrepresented
  --continue-uncovered      Add token-bounded batches until changed-file textual coverage is complete
  --batch-tokens <n>        Per-batch audit budget (default: 4000)
  --profile <name>          Select a side-by-side named index profile
  --embed-model <name>      Override remote embedding model
  --embed-dim <n>           Override embedding dimension
  --provider <name>         ollama|gemini|openai|bedrock
  --semantic-kind <kind>    Framework-aware kind (convexMutation, reactComponent, routeHandler, etc.)
  --explain-filters         Include deterministic filter match explanations
  --strict-parent           Mark parent filter as strict indexed-metadata validation
  --strict-imports          Require an exact normalized import module specifier
  --regex                   Interpret a literal query as a regular expression
  --ignore-case             Make literal matching case-insensitive
  --filesystem              Search all ripgrep-visible files, independent of the index
  --max-output-bytes <n>    Bound literal output size
  --ensure-fresh <mode>     check|incremental|full before search/survey/cluster/duplicates
  --root <dir>              Root directory (default: cwd)
  --no-shake                Disable semantic tree-shaking in output
  --watch                   Keep running; reindex on changes (default: on)
  --no-watch                Exit after indexing (for CI/scripts)
  --include-docs            Include markdown/docs in the index (default: false)
  --include-config          Include config files (JSON/YAML/TOML) in the index (default: false)
  --timeout <duration>      Abort index phases after duration (e.g. 30s, 5m; bare numbers are seconds)
  --max-files <n>           Index at most N files (smoke tests/diagnostics)
  --log-format jsonl|none   Emit progress logs as JSON Lines on stderr, or suppress logs with none
  --json                    Output JSON

Survey options:
  --raw-limit <n>           Raw matches to gather before grouping (default: 60)
  --per-group <n>           Representative snippets per group (default: 2)
  --json-detail <mode>      summary|representatives|full (default: representatives)

Cluster options:
  --raw-limit <n>           Raw matches to gather before clustering (default: 70)
  --per-cluster <n>         Representative snippets per cluster (default: 2)
  --cluster-threshold <n>   Similarity threshold for linking clusters (default: 0.72)
  --min-cluster-size <n>    Minimum cluster size before singleton fallback (default: 2)
  --json-detail <mode>      summary|representatives|full (default: representatives)

Duplicate detection options:
  --threshold <number>      Minimum similarity 0.0-1.0 (default: 0.85)
  --scope <type>            function, method, or all (default: function,method)
  --language <lang>         Filter by language (comma-separated)
  --include <glob>          Include only matching indexed file paths
  --exclude <glob>          Exclude matching indexed file paths
  --cross-language          Detect duplicates across languages (default: off)
  --ignore-tests            Ignore test files
  --cross-file-only         Only report cross-file duplicates
  --only-exported           Only check exported functions
  --exclude-pattern <regex> Exclude functions matching pattern
  --min-lines <n>           Minimum lines (default: 10)
  --min-complexity <n>      Minimum complexity (default: 0)
  --max-candidates <n>      Max duplicate candidates to analyze (default: 1500)
  --ignore-acceptable-patterns  Do not ignore simple validations/guards
  --normalize-identifiers <true|false>  Normalize identifiers (default: true)
  --no-normalize-identifiers    Disable identifier normalization
  --rank-by-impact <true|false> Rank by impact score (default: true)
  --no-rank-by-impact           Disable ranking by impact
  --limit <n>               Show top N results (default: 10)
  --full-code               Show full code snippets (no truncation)
  --show-code               Display actual duplicate code
  --verbose                 Show full details
  --quiet                   Only show summary
  --json                    Output JSON

Language management:
  sensegrep languages                 List supported languages
  sensegrep languages --detect        Detect project languages
  sensegrep languages --variants      Show all variants by language
  sensegrep semantic-kinds            List framework-aware semanticKind filters
  sensegrep semantic-kinds --json     Include aliases accepted by --semantic-kind

Index health:
  sensegrep status                    Fast metadata-only index stats
  sensegrep status --verify           Include freshness verification (can scan/hash files)
  sensegrep status --verbose          Include freshness verification plus changed/missing/removed file lists
  sensegrep verify --strict           Exit non-zero unless the index is healthy and fresh
  sensegrep index --check             Exit non-zero if index is stale
  sensegrep index --check --max-changed 5 --max-missing 0
  sensegrep index migrate --no-watch     Atomic full rebuild for an incompatible schema
  sensegrep index rebuild --atomic --no-watch
`
