# Roadmap

This roadmap is intentionally short-horizon and focused on adoption + reliability.

## Growth and Positioning (in progress)

Converting real but invisible usage into public proof, community infrastructure, and
distribution-ready material. The project is early but showing usage, and these items make
that visible.

- **Use-cases documentation**: consolidate concrete AI-agent scenarios (Claude Code, Cursor,
  Codex) in [docs/use-cases.md](docs/use-cases.md), each tied to how sensegrep delivers
  smaller, more relevant context.
- **Parallel-agent workflows**: document `@sensegrep/mcp` across concurrent agents on one
  codebase in [docs/parallel-agents.md](docs/parallel-agents.md), including concurrency-affecting
  configuration.
- **Community scaffolding**: a use-case issue template, an expanded label scheme (including
  `use case` alongside `good first issue`), good-first-issue descriptions, and GitHub
  Discussions for questions and shared use cases.
- **Distribution drafts**: review-ready, drafts-only launch material under
  [docs/distribution/](docs/distribution/) for LinkedIn, Show HN, Reddit, awesome-list and
  MCP directory submissions, plus the parallel-agent follow-up. Nothing is posted automatically.

Sharpened positioning across `@sensegrep/core`, `@sensegrep/cli`, and `@sensegrep/mcp`
follows a single thesis: AI agents should not read more code, they should read the right code.

## Now (Month 1): Adoption and DX

- Publish integration recipes for Claude Code, Cursor, Codex, and CI.
- Publish reproducible case studies focused on practical search outcomes.
- Improve repository onboarding with README media and faster time-to-value.
- Standardize issue labels for contributor routing (`good first issue`, `help wanted`, etc.).

## Next (Month 2): Benchmark Methodology

- Publish reproducible benchmark design vs `ripgrep` and `ast-grep`.
- Add fixed datasets + query sets with documented constraints.
- Report quality and latency metrics with transparent methodology.
- Automate benchmark reports in CI as non-blocking artifacts.

## Later (Month 3): Ecosystem Expansion

- Expand language coverage and language-specific variants.
- Improve editor and MCP ergonomics based on recipe feedback.
- Add more guided migration paths from text-first workflows to semantic workflows.
