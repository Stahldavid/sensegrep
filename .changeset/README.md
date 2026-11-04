# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

## How to use

### Create a changeset (on your feature branch)

```bash
npm run changeset
```

It will ask:
1. Which packages changed? (`@sensegrep/core`, `@sensegrep/cli`, `@sensegrep/mcp` are linked — picking any one bumps all three)
2. What type of change? `patch` | `minor` | `major`
3. A short summary for the CHANGELOG

Commit the generated `.changeset/*.md` file together with your changes.

### Release flow

Release workflows are manual (`workflow_dispatch`). A merge alone does not publish.

1. Create and review a changeset with the implementation.
2. Run `npm run version` to consume changesets and synchronize package/plugin versions.
3. Validate and push the exact candidate commit.
4. When publication is explicitly authorized, dispatch the Release workflow on that ref. It validates the candidate, then publishes through npm trusted publishing with provenance. If changesets remain, the action prepares a version PR instead.
5. Confirm package versions, source commit and downloadable tarballs in the registry. npm metadata and tarballs may propagate at different times.

The editor extension has a separate publication lifecycle; npm publication does not publish to the VS Code Marketplace.

### Manual commands

| Command | What it does |
|---------|-------------|
| `npm run changeset` | Create a new changeset |
| `npm run version` | Consume changesets → bump versions + update CHANGELOGs |
| `npm run release` | Build + publish all changed packages to npm |

### Package versioning strategy

- `@sensegrep/core`, `@sensegrep/cli`, `@sensegrep/mcp` are **linked** — they always share the same version.
- `sensegrep` (VS Code extension) is **excluded** from Changesets and is published separately via `vsce` in the release workflow.
