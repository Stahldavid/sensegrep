# @sensegrep/core

Semantic + structural code search engine used by the sensegrep CLI, MCP server, and VS Code extension.

## Install

```bash
npm install @sensegrep/core
```

When upgrading to 1.20.1 from an older version on Windows, stop active indexers, watchers, MCP servers and daemons for the checkout first. Restart the updated runtimes together. Windows lock keys now normalize case; old and new indexing runtimes must not use the same checkout during the upgrade.

## Usage

```ts
import { index, search } from "@sensegrep/core"

await index({ rootDir: process.cwd(), mode: "incremental" })
const results = await search({ query: "authentication and token validation" })
console.log(results)
```

## Documentation

- Repository: https://github.com/Stahldavid/sensegrep
- Docs: https://github.com/Stahldavid/sensegrep/tree/main/docs
- Issues: https://github.com/Stahldavid/sensegrep/issues
