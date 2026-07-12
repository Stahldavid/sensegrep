# @sensegrep/cli

Command-line interface for sensegrep semantic + structural code search.

## Install

```bash
npm install -g @sensegrep/cli
```

## Quickstart

```bash
sensegrep index --root .
sensegrep status --root .              # fast metadata-only stats
sensegrep status --root . --verify     # freshness check
sensegrep search "error handling and retry logic"
sensegrep search emit --exact --no-shake --include "src/**/*.ts"
sensegrep search "request flow" --purpose understand --json
sensegrep show <result-id> --before 10 --after 20
sensegrep literal "TODO:" --filesystem --max-output-bytes 50000 --json
sensegrep audit "regression risks" --base origin/main --require-coverage --continue-uncovered --max-total-tokens 8000 --max-output-bytes 32000 --max-batches 8
sensegrep investigate "where is access blocked before payment?" --dry-run
sensegrep daemon start
sensegrep daemon call --tool search --arguments '{"query":"request flow","limit":5}'
sensegrep survey "authentication login token" --limit 4
sensegrep cluster "checkout payment order cart" --limit 4
sensegrep detect-duplicates --cross-file-only --timeout 30s
sensegrep semantic-kinds --json
```

`status`, `verify`, search, graph, and indexed literal open existing indexes read-only. `literal --filesystem` and `show` use lightweight paths that do not open the vector table. If the table schema is old, commands report `schemaCompatible: false` and recommend an atomic full rebuild; they never recreate the active table. Search JSON defaults to minified `minimal` cards, while survey/cluster JSON defaults to `summary`. Use `--json-detail content|representatives|diagnostic|full`, as supported by each command, `--diagnostic`, or `--pretty` to opt into heavier output. Audit `--batch-tokens` is a strict per-batch ceiling, including explicit split ranges from large files. Duplicate JSON omits code unless `--show-code` is set.

`--json` writes parseable JSON to stdout; progress and warnings are written to stderr.
Argument errors under `--json` also use stdout JSON and exit code 2. `--max-output-bytes`
is enforced against the complete serialized payload.
Hybrid retrieval runs semantic and lexical work concurrently and uses one batched index read
for lexical matches. `--hybrid-mode adaptive` is the default; `--no-hybrid` is available for
latency-sensitive semantic-only discovery. Deterministic query embeddings are cached locally
by opaque hash unless `SENSEGREP_QUERY_CACHE=false`.
The daemon is query-only by default; `daemon start --watch` explicitly enables background
incremental indexing.
Use `--log-format none` when a JSON command must suppress all non-fatal logs entirely.
If an `--include`/`--exclude` scope matches no indexed files, JSON output includes a
structured warning instead of failing silently.

## Documentation

- CLI reference: https://github.com/Stahldavid/sensegrep/blob/main/docs/cli-reference.md
- Getting started: https://github.com/Stahldavid/sensegrep/blob/main/docs/getting-started.md
- Issues: https://github.com/Stahldavid/sensegrep/issues
