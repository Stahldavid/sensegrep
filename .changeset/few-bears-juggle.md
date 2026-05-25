---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Add theme-oriented `survey` and `cluster` workflows to sensegrep.

`survey` groups broad semantic results into readable domains with representative tree-shaken snippets, while `cluster` decomposes wide queries into coherent subthemes using embeddings, AST metadata, path signals, and import hints.

The release also wires both commands through the CLI, MCP server, README, and bundled skills so they are discoverable everywhere sensegrep is used.
