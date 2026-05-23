---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Add first-class Vue SFC semantic support across indexing and search.

Vue single-file components now use tree-sitter-vue to locate script blocks and
tree-sitter TypeScript/JavaScript for semantic chunking of `<script>` and
`<script setup>`. Metadata covers Composition API and Options API symbols,
tree-shaking preserves relevant SFC sections, and the CLI/VS Code surfaces expose
Vue as a selectable language.
