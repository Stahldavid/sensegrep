---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Fix Bedrock indexing failures and improve Vue chunking reliability.

Re-enable embedding input validation for LanceDB indexing, truncate oversized
Bedrock payloads, batch requests by payload size, split minified JS chunks
even inside nested blocks, and index template-only Vue SFCs as component chunks.
