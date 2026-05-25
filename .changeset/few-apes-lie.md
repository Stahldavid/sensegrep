---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Improve indexing resilience for large and generated repositories.

This change teaches the indexer to respect project-level include/exclude config, ignore common minified and sourcemap assets by default, split oversized fallback chunks safely, and retry transient Bedrock service errors more gracefully.
