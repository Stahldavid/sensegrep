---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Add first-class Java semantic support across indexing and search.

Java files now use tree-sitter-based semantic chunking with metadata for classes,
interfaces, records, annotation types, methods, constructors, fields, modifiers,
Javadoc, imports, and parent scope. Tree-shaking and language discovery also
support Java, and the CLI/VS Code surfaces expose Java as a selectable language.
