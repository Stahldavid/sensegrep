# Recipe: Generic CI (Any Provider)

## Goal

Run sensegrep checks in any CI provider (GitLab CI, CircleCI, Jenkins, Buildkite, etc.).

## Prerequisites

- Node.js 18+
- Internet access to install `@sensegrep/cli`

## Baseline CI Script

```bash
#!/usr/bin/env bash
set -euo pipefail

npm ci
npm i -g @sensegrep/cli

sensegrep index --root .
sensegrep search "authentication and authorization logic" --limit 15
sensegrep detect-duplicates --cross-file-only --limit 10
```

## Smoke Test

1. Run in CI on default branch.
2. Verify indexing and both checks complete with exit code 0.
3. Confirm logs are visible in CI artifacts or console output.

## Practical Workflows

1. Pre-merge smoke:
   Run fixed query checks on merge requests.
2. Weekly deep scan:
   Increase limits and persist JSON output.
3. Component-level checks:
   Use `--include` per service/package.
4. Release readiness:
   Run semantic checks before tagging releases.
5. Duplicate triage feed:
   Export duplicates to ticketing automation.

## Troubleshooting

- OOM in small runners:
  Scope with `--include` and reduce concurrent CI workload.
- Non-deterministic logs:
  Use fixed query files and explicit flags.
- Slow startup:
  Cache npm dependencies between runs.
