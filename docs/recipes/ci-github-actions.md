# Recipe: CI with GitHub Actions

## Goal

Run reproducible semantic checks in pull requests without requiring local setup.

## Prerequisites

- Repository on GitHub
- Node.js 18+ project
- `@sensegrep/cli` available via npm

## Workflow (copy-paste)

Create `.github/workflows/sensegrep-smoke.yml`:

```yaml
name: Sensegrep Smoke

on:
  pull_request:
  workflow_dispatch:

jobs:
  sensegrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm i -g @sensegrep/cli
      - run: sensegrep index --root .
      - run: sensegrep search "error handling and retry logic" --limit 10
      - run: sensegrep detect-duplicates --cross-file-only --limit 5
```

## Smoke Test

1. Run workflow via `workflow_dispatch`.
2. Confirm all steps pass.
3. Confirm search and duplicate commands print non-empty structured output.

## Practical Workflows

1. PR guardrail:
   Keep a fixed high-signal query set as smoke checks.
2. Refactor safety:
   Add `--type function --min-complexity 6` scans before merges.
3. Duplicate drift monitor:
   Track top-N duplicates and fail on threshold breaches (optional).
4. Language-specific checks:
   Separate jobs by `--language typescript` and `--language python`.
5. JSON output export:
   Use `--json` and upload artifacts for review.
6. Scheduled weekly scan:
   Add `schedule` trigger for maintenance reports.

## Troubleshooting

- Job timeout on large monorepo:
  Start with scoped `--include` and smaller `--limit`.
- Empty query output:
  Validate that indexing step used repository root.
- Dependency conflicts:
  Pin Node and use lockfile-based install.
