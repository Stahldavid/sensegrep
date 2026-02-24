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

```
feature branch  →  PR (with changeset file)
                         ↓ merge to main
                   CI creates "chore: version packages" PR automatically
                         ↓ merge that PR
                   CI publishes to npm + VS Code Marketplace
```

### Manual commands

| Command | What it does |
|---------|-------------|
| `npm run changeset` | Create a new changeset |
| `npm run version` | Consume changesets → bump versions + update CHANGELOGs |
| `npm run release` | Build + publish all changed packages to npm |

### Package versioning strategy

- `@sensegrep/core`, `@sensegrep/cli`, `@sensegrep/mcp` are **linked** — they always share the same version.
- `sensegrep` (VS Code extension) is **excluded** from Changesets and is published separately via `vsce` in the release workflow.
