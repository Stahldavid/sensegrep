# Week 1 Launch Checklist

Use this runbook when you are ready to publish.
This document is publication-ready and ordered to reduce risk.

## 0. Prerequisites

- Node.js >= 18 and npm installed
- npm auth is valid for publish rights
- GitHub auth is valid (`gh auth status`)
- VS Code Marketplace PAT is configured for `vsce` (`VSCE_PAT` is set in your shell/CI)
- Clean local build environment

Recommended auth checks:

```bash
npm whoami
gh auth status
npx @vscode/vsce --version
test -n "$VSCE_PAT" && echo "VSCE_PAT is set" || echo "VSCE_PAT is missing"
```

If needed, set it for the current shell before publishing:

```bash
export VSCE_PAT="<your-marketplace-pat>"
```

PowerShell equivalents:

```powershell
if ($env:VSCE_PAT) { "VSCE_PAT is set" } else { "VSCE_PAT is missing" }
$env:VSCE_PAT = "<your-marketplace-pat>"
```

## 1. Local Preflight

```bash
git status --short
npm install
npm run check
```

Optional dry runs before publish:

```bash
npm pack --workspace packages/core --dry-run
npm pack --workspace packages/cli --dry-run
npm pack --workspace packages/mcp --dry-run
npm run package --workspace packages/vscode
```

## 2. Validate Current Published Versions

```bash
npm view @sensegrep/core version
npm view @sensegrep/cli version
npm view @sensegrep/mcp version
```

Confirm local package versions are newer than published versions.

## 3. Publish npm Packages (Fixed Order)

Publish in this exact order to avoid dependency drift:

```bash
npm publish --workspace packages/core --access public
npm publish --workspace packages/cli --access public
npm publish --workspace packages/mcp --access public
```

Post-publish validation:

```bash
npm view @sensegrep/core version
npm view @sensegrep/cli version
npm view @sensegrep/mcp version
```

## 4. Publish VS Code Extension

Build and package:

```bash
npm run package --workspace packages/vscode
```

Publish:

```bash
npm run publish --workspace packages/vscode
```

Verify listing:

- Marketplace page loads
- Icon, banner, README media, and keywords are visible

## 5. Publish to Official MCP Registry

Publisher login (CLI binary):

```bash
mcp-publisher login github
```

Publish:

```bash
mcp-publisher publish server.json
```

If `mcp-publisher` is not installed in PATH, use the downloaded binary directly (Windows example):

```powershell
& "$env:TEMP\mcp-publisher.exe" login github
& "$env:TEMP\mcp-publisher.exe" publish server.json
```

Note: `npx mcp-publisher` can return `404` because this publisher is not distributed as `mcp-publisher` on npm.

Verify:

- `io.github.Stahldavid/sensegrep` resolves in official registry
- npm package reference is correct (`@sensegrep/mcp`)

## 6. Post-Publish Verification

- Check GitHub release notes and changelog alignment
- Confirm installation paths still work from README:
  - `npm i -g @sensegrep/cli`
  - `npx -y @sensegrep/mcp`
- Run one smoke search on a small repo

## 7. Rollback and Hotfix Notes

- If npm publish has a metadata issue, publish a patch version; do not unpublish stable artifacts.
- If VS Code listing metadata is wrong, patch `packages/vscode/package.json` and publish patch.
- If MCP registry metadata is wrong, submit corrected metadata immediately after npm patch.
