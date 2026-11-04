# Contributing to sensegrep

Thank you for your interest in contributing to sensegrep! This guide will help you get started.

## Prerequisites

- **Node.js 24** recommended (`.nvmrc`). Development tooling also supports `^22.12.0 || ^24.0.0 || >=26.0.0`; do not infer published runtime requirements from development-only dependencies.
- **npm** (comes with Node.js)
- **Git**

## Development Setup

```bash
# Clone the repository
git clone https://github.com/Stahldavid/sensegrep.git
cd sensegrep

# Install the locked dependencies
npm ci

# Build all packages
npm run build

# Validate without rebuilding three times
npm run check:types
npm run test:unit
npm run test:node
npm run test:python
npm run version:check
npm run release:verify
npm run check:docs
```

## Project Structure

sensegrep is a monorepo with four packages:

```
packages/
├── core/       # Search engine library (@sensegrep/core)
│   └── src/
│       └── semantic/
│           ├── chunking.ts      # Chunk orchestration and fallbacks
│           ├── chunking-treesitter.ts # TypeScript/JavaScript AST chunking
│           ├── embeddings-remote.ts # Remote embeddings providers
│           ├── indexer.ts       # Index creation and incremental updates
│           ├── lancedb.ts       # LanceDB vector store
│           ├── tree-shaker.ts   # Output collapsing/tree-shaking
│           └── language/        # Language-specific parsers
├── cli/        # CLI wrapper (@sensegrep/cli)
├── mcp/        # MCP server for AI agents (@sensegrep/mcp)
└── vscode/     # VS Code extension
```

## Making Changes

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make your changes** and ensure the build passes:
   ```bash
   npm run build
   npm test
   ```

3. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(core): add Go language support
   fix(cli): handle missing index gracefully
   docs: update MCP setup guide
   ```

   Common prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

For changes to the VS Code extension, also run:

```bash
npm test --workspace sensegrep
```

Contract changes must preserve failure states and source identity. Research labels must be independently reviewed and grouped to avoid development/holdout leakage; `scripts/evaluation-contract.mjs` validates registrations. See [the implementation and validation record](docs/reliability-integrity-2026-09-25.md).

Concurrency changes must include overlapping-operation tests. Index persistence changes must prove that the previously active index remains readable when staging or writes fail.

4. **Push** and open a Pull Request against `main`.

## Adding a New Language

Language support lives in `packages/core/src/semantic/language/`. To add a new language:

1. Create a new file (e.g., `go.ts`) implementing the language parser
2. Register the language in the language registry
3. Add the corresponding tree-sitter WASM grammar
4. Add tests for the new language's symbol extraction
5. Update the CLI usage text and MCP tool descriptions

See the existing `typescript.ts` and `python.ts` implementations for reference.

## Code Style

- TypeScript with strict mode enabled
- ESM modules (`"type": "module"`)
- No semicolons are fine - follow existing file style
- Keep functions focused and small

## Reporting Issues

- Use the [bug report template](https://github.com/Stahldavid/sensegrep/issues/new?template=bug_report.yml) for bugs
- Use the [feature request template](https://github.com/Stahldavid/sensegrep/issues/new?template=feature_request.yml) for new ideas
- Check existing issues before creating a new one
- Look for labels like `good first issue` and `help wanted` if you want a curated starting point

## Roadmap and Priorities

- See [ROADMAP.md](ROADMAP.md) for current focus areas and upcoming milestones.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
