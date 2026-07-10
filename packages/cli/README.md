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
sensegrep audit "regression risks" --base origin/main --require-coverage --continue-uncovered
sensegrep investigate "where is access blocked before payment?" --dry-run
sensegrep daemon start
sensegrep daemon call --tool search --arguments '{"query":"request flow","limit":5}'
sensegrep survey "authentication login token" --limit 4
sensegrep cluster "checkout payment order cart" --limit 4
sensegrep detect-duplicates --cross-file-only
sensegrep semantic-kinds --json
```

`status`, `verify`, search, graph, and literal open existing indexes read-only. If the table schema is old, they report `schemaCompatible: false` and recommend an atomic full rebuild; they never recreate the active table. Search JSON defaults to compact result cards and omits rendered Markdown. Expand selected cards with `sensegrep show` or request `--json-detail full`.

`--json` writes parseable JSON to stdout; progress and warnings are written to stderr.
Use `--log-format none` when a JSON command must suppress human progress logs entirely.
If an `--include`/`--exclude` scope matches no indexed files, JSON output includes a
structured warning instead of failing silently.

## Documentation

- CLI reference: https://github.com/Stahldavid/sensegrep/blob/main/docs/cli-reference.md
- Getting started: https://github.com/Stahldavid/sensegrep/blob/main/docs/getting-started.md
- Issues: https://github.com/Stahldavid/sensegrep/issues
