import { Log } from "@/util/log"
import { lazy } from "@/util/lazy"
import type { Tree } from "web-tree-sitter"
import { fileURLToPath } from "url"
import type { Chunking } from "./chunking"

// SyntaxNode type from web-tree-sitter (not directly exported, so we define it)
type SyntaxNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  parent: SyntaxNode | null
  childCount: number
  child: (index: number) => SyntaxNode | null
  childForFieldName: (name: string) => SyntaxNode | null
  walk: () => TreeCursor
  hasError: boolean
}

type TreeCursor = {
  currentNode: () => SyntaxNode
  gotoFirstChild: () => boolean
  gotoNextSibling: () => boolean
}

const log = Log.create({ service: "semantic.chunking-treesitter" })

// Chunk size limits (must match chunking.ts)
const MAX_CHUNK_SIZE = 1500
const MIN_CHUNK_SIZE = 100
const STATEMENT_OVERLAP = 3 // Number of previous statements to include for context

// Adaptive chunk sizes based on complexity
const CHUNK_SIZE_CONFIG = {
  simple: 2000, // Simple functions, getters, utilities
  medium: 1500, // Default
  complex: 1000, // Many loops, conditionals, nested logic
}

// WASM path resolver (same pattern as bash.ts)
const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

// Lazy-loaded TypeScript/JavaScript parser
const tsParser = lazy(async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const { default: tsWasm } = await import("tree-sitter-wasms/out/tree-sitter-typescript.wasm" as string, {
    with: { type: "wasm" },
  })
  const tsPath = resolveWasm(tsWasm)
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const tsLanguage = await Language.load(tsPath)
  const p = new Parser()
  p.setLanguage(tsLanguage)
  return p
})

// Lazy-loaded TSX parser (TSX has different grammar)
const tsxParser = lazy(async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const { default: tsxWasm } = await import("tree-sitter-wasms/out/tree-sitter-tsx.wasm" as string, {
    with: { type: "wasm" },
  })
  const tsxPath = resolveWasm(tsxWasm)
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const tsxLanguage = await Language.load(tsxPath)
  const p = new Parser()
  p.setLanguage(tsxLanguage)
  return p
})

export namespace TreeSitterChunking {
  /**
   * Check if file type is supported by tree-sitter chunking
   */
  export function isSupported(filePath: string): boolean {
    return (
      filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".jsx")
    )
  }

  /**
   * Check if a lexical declaration contains an arrow function (const foo = () => {})
   */
  function isArrowFunctionDeclaration(node: SyntaxNode): boolean {
    if (node.type !== "lexical_declaration" && node.type !== "variable_declaration") {
      return false
    }

    // Look for variable_declarator -> arrow_function pattern
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "variable_declarator") {
        for (let j = 0; j < child.childCount; j++) {
          const valueNode = child.child(j)
          if (valueNode?.type === "arrow_function") {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * Node types that define chunk boundaries
   */
  function isChunkBoundary(node: SyntaxNode): boolean {
    const boundaryTypes = [
      "function_declaration",
      "function_signature",
      "method_definition",
      "class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
      "module", // TypeScript module/namespace
      "internal_module", // namespace declarations
      "lexical_declaration", // const/let/var at top level
      "variable_declaration",
    ]

    // Check if this is a top-level boundary
    if (boundaryTypes.includes(node.type)) {
      // For lexical declarations, only treat as boundary if:
      // 1. It's exported or top-level AND
      // 2. It contains an arrow function OR is a significant declaration
      if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        const parent = node.parent
        if (parent?.type === "export_statement" || parent?.type === "program") {
          // Always include arrow functions as boundaries
          if (isArrowFunctionDeclaration(node)) {
            return true
          }
          // Include other declarations that are large enough
          return true
        }
        return false
      }
      return true
    }

    // Export statements can be boundaries if they contain declarations
    if (node.type === "export_statement") {
      // Check if it contains a declaration
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && boundaryTypes.includes(child.type)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Get line range for a node (1-indexed to match Chunk interface)
   */
  function getNodeLines(node: SyntaxNode): { start: number; end: number } {
    return {
      start: node.startPosition.row + 1, // tree-sitter is 0-indexed
      end: node.endPosition.row + 1,
    }
  }

  /**
   * Extract content for a node from lines array
   */
  function extractNodeContent(node: SyntaxNode, lines: string[]): string {
    const range = getNodeLines(node)
    // Extract lines (range is 1-indexed, array is 0-indexed)
    const nodeLines = lines.slice(range.start - 1, range.end)
    return nodeLines.join("\n")
  }

  /**
   * Extract node content with JSDoc and leading comments
   */
  function extractNodeWithContext(
    node: SyntaxNode,
    lines: string[],
    filePath: string,
  ): {
    content: string
    actualStartLine: number
    hasJSDoc: boolean
  } {
    let startLine = node.startPosition.row
    let hasJSDoc = false
    const jsDocPattern = /^\s*\/\*\*/
    const commentPattern = /^\s*\/\//

    // Look back up to 20 lines for JSDoc or comments
    for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
      const line = lines[i].trim()

      // Found JSDoc start
      if (jsDocPattern.test(lines[i])) {
        startLine = i
        hasJSDoc = true
        break
      }

      // Continue through comment lines
      if (commentPattern.test(lines[i]) || line === "" || line === "*/" || line.startsWith("*")) {
        continue
      }

      // Hit real code, stop
      if (line) {
        break
      }
    }

    const content = lines.slice(startLine, node.endPosition.row + 1).join("\n")

    return {
      content,
      actualStartLine: startLine + 1, // Convert to 1-indexed
      hasJSDoc,
    }
  }

  /**
   * Extract the name of a node (function, class, namespace, etc.)
   */
  function extractNodeName(node: SyntaxNode): string | undefined {
    // Try to find identifier child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "identifier") {
        return child.text
      }
      // For export statements, look inside the exported declaration
      if (child?.type === "internal_module" || child?.type === "module") {
        for (let j = 0; j < child.childCount; j++) {
          const moduleChild = child.child(j)
          if (moduleChild?.type === "identifier") {
            return moduleChild.text
          }
        }
      }
    }
    return undefined
  }

  /**
   * Calculate cyclomatic complexity of a node
   */
  function calculateComplexity(node: SyntaxNode): number {
    let score = 0

    // Complexity increases with control flow
    const complexityNodes = [
      "if_statement",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
      "switch_statement",
      "case",
      "catch_clause",
      "conditional_expression", // ternary
    ]

    // Walk all descendants and count complexity indicators
    const walk = (n: SyntaxNode) => {
      if (complexityNodes.includes(n.type)) {
        score += n.type === "switch_statement" ? 2 : 1
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)
    return score
  }

  /**
   * Get adaptive max chunk size based on node complexity
   */
  function getMaxChunkSize(node: SyntaxNode): number {
    const complexity = calculateComplexity(node)

    if (complexity < 5) return CHUNK_SIZE_CONFIG.simple
    if (complexity < 15) return CHUNK_SIZE_CONFIG.medium
    return CHUNK_SIZE_CONFIG.complex
  }

  /**
   * Check if content is only imports
   */
  function isOnlyImports(content: string): boolean {
    const lines = content.split("\n").filter((l) => l.trim())
    return lines.every((l) => l.trim().startsWith("import ") || l.trim() === "")
  }

  /**
   * Extract semantic keywords from content for better embeddings
   */
  function extractKeywords(content: string, nodeName: string | undefined): string[] {
    const keywords: string[] = []

    // Add the node name
    if (nodeName) keywords.push(nodeName)

    // Extract JSDoc keywords
    const jsDocMatch = content.match(/\/\*\*([\s\S]*?)\*\//)
    if (jsDocMatch) {
      const jsDoc = jsDocMatch[1]
      // Extract @param, @returns, @throws tags
      const paramMatches = jsDoc.matchAll(/@param\s+(?:\{[^}]+\}\s+)?(\w+)/g)
      for (const match of paramMatches) {
        keywords.push(`param:${match[1]}`)
      }
      const returnsMatch = jsDoc.match(/@returns?\s+(?:\{([^}]+)\})?/)
      if (returnsMatch && returnsMatch[1]) {
        keywords.push(`returns:${returnsMatch[1]}`)
      }
    }

    // Detect async/promise patterns
    if (content.includes("async ") || content.includes("await ")) {
      keywords.push("async")
    }

    // Detect error handling
    if (content.includes("throw ") || content.match(/catch\s*\(/)) {
      keywords.push("error-handling")
    }

    // Detect testing
    if (content.match(/\b(test|describe|it|expect)\(/)) {
      keywords.push("test")
    }

    // Detect HTTP/API
    if (content.match(/\b(fetch|http|api|request|response)\b/i)) {
      keywords.push("http")
    }

    // Detect file operations
    if (content.match(/\b(readFile|writeFile|readdir|unlink|mkdir|Bun\.file)\b/)) {
      keywords.push("filesystem")
    }

    // Detect database operations
    if (content.match(/\b(query|database|sql|insert|update|delete|select)\b/i)) {
      keywords.push("database")
    }

    // Extract function calls (e.g., "foo(" -> "calls:foo")
    const callMatches = content.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)
    const calls = new Set<string>()
    const ignoreList = new Set([
      "if",
      "for",
      "while",
      "switch",
      "catch",
      "function",
      "async",
      "await",
      "return",
      "throw",
      "new",
      "typeof",
      "instanceof",
    ])
    for (const match of callMatches) {
      const name = match[1]
      if (!ignoreList.has(name) && name.length > 2 && calls.size < 5) {
        calls.add(name)
      }
    }
    if (calls.size > 0) {
      keywords.push(`calls:${Array.from(calls).join(",")}`)
    }

    // Extract type annotations (e.g., ": string", ": User[]")
    const typeMatches = content.matchAll(/:\s*([A-Z][a-zA-Z0-9]*(?:<[^>]+>)?(?:\[\])?)/g)
    const types = new Set<string>()
    for (const match of typeMatches) {
      const typeName = match[1].replace(/<.*>/, "").replace("[]", "")
      if (typeName.length > 1 && types.size < 5) {
        types.add(typeName)
      }
    }
    if (types.size > 0) {
      keywords.push(`types:${Array.from(types).join(",")}`)
    }

    // Extract imports used in this chunk
    const importMatches = content.matchAll(/\bfrom\s+["']([^"']+)["']/g)
    const imports = new Set<string>()
    for (const match of importMatches) {
      const moduleName = match[1].split("/").pop() || match[1]
      if (imports.size < 3) {
        imports.add(moduleName)
      }
    }
    if (imports.size > 0) {
      keywords.push(`imports:${Array.from(imports).join(",")}`)
    }

    return keywords
  }

  /**
   * Add structured context prefix to chunk content
   */
  function addContextPrefix(
    content: string,
    filePath: string,
    nodeType: string,
    nodeName: string | undefined,
    isExported: boolean,
  ): string {
    const relativePath = filePath.replace(/^.*\/packages\/opencode\//, "")
    const keywords = extractKeywords(content, nodeName)
    const keywordsLine = keywords.length > 0 ? `\n// Keywords: ${keywords.join(", ")}` : ""

    return `// File: ${relativePath}
// Type: ${nodeType}${nodeName ? `\n// Name: ${nodeName}` : ""}
// Exported: ${isExported}${keywordsLine}

${content}`
  }

  /**
   * Extract semantic metadata from a node for rich indexing
   */
  function extractMetadata(node: SyntaxNode, filePath: string, parentScope?: string): Partial<Chunking.Chunk> {
    const nodeName = extractNodeName(node)
    const complexity = calculateComplexity(node)
    const isExported = node.parent?.type === "export_statement"

    // Determine symbol type from AST node type
    let symbolType: string | undefined
    switch (node.type) {
      case "function_declaration":
      case "function_signature":
        symbolType = "function"
        break
      case "class_declaration":
        symbolType = "class"
        break
      case "method_definition":
        symbolType = "method"
        break
      case "interface_declaration":
        symbolType = "interface"
        break
      case "type_alias_declaration":
        symbolType = "type"
        break
      case "enum_declaration":
        symbolType = "enum"
        break
      case "internal_module":
      case "module":
        symbolType = "namespace"
        break
      case "lexical_declaration":
      case "variable_declaration":
        // Check if it's an arrow function
        if (isArrowFunctionDeclaration(node)) {
          symbolType = "function"
        } else {
          symbolType = "variable"
        }
        break
      case "export_statement":
        // For export statements, try to get the type from the child
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && isChunkBoundary(child)) {
            const childMeta = extractMetadata(child, filePath, parentScope)
            return childMeta
          }
        }
        break
    }

    // Check for JSDoc/documentation
    const nodeText = node.text
    const hasDocumentation = /\/\*\*/.test(nodeText) || /^\/\//.test(nodeText)

    // Calculate scope depth (how many parents until we hit program)
    let scopeDepth = 0
    let current = node.parent
    while (current && current.type !== "program") {
      scopeDepth++
      current = current.parent
    }

    // Determine language from file extension
    let language: string | undefined
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      language = "typescript"
    } else if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
      language = "javascript"
    }

    return {
      symbolName: nodeName,
      symbolType,
      complexity,
      isExported,
      parentScope,
      scopeDepth,
      hasDocumentation,
      language,
    }
  }

  /**
   * Get direct statement children of a node (for splitting large functions/namespaces)
   */
  function getStatements(node: SyntaxNode): SyntaxNode[] {
    const statements: SyntaxNode[] = []

    // Find the body node - could be statement_block (function) or namespace body
    let bodyNode: SyntaxNode | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "statement_block") {
        bodyNode = child
        break
      }
    }

    // For namespaces/modules, the body is inside internal_module or module
    if (!bodyNode) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child?.type === "internal_module" || child?.type === "module") {
          // Find the statement_block inside the module
          for (let j = 0; j < child.childCount; j++) {
            const moduleChild = child.child(j)
            if (moduleChild?.type === "statement_block") {
              bodyNode = moduleChild
              break
            }
          }
          break
        }
      }
    }

    // For export_statement wrapping a namespace
    if (!bodyNode && node.type === "export_statement") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child?.type === "internal_module" || child?.type === "module") {
          // Recursively get statements from the namespace
          return getStatements(child)
        }
      }
    }

    if (!bodyNode) return statements

    // Collect direct children that are statements
    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type !== "{" && child.type !== "}") {
        statements.push(child)
      }
    }

    return statements
  }

  /**
   * Extract class signature (everything up to first method)
   */
  function extractClassSignature(
    classNode: SyntaxNode,
    lines: string[],
  ): {
    signature: string
    endLine: number
  } {
    // Find class_body
    let classBody: SyntaxNode | null = null
    for (let i = 0; i < classNode.childCount; i++) {
      const child = classNode.child(i)
      if (child?.type === "class_body") {
        classBody = child
        break
      }
    }

    if (!classBody) {
      return { signature: extractNodeContent(classNode, lines), endLine: classNode.endPosition.row }
    }

    // Find first method
    let firstMethod: SyntaxNode | null = null
    for (let i = 0; i < classBody.childCount; i++) {
      const child = classBody.child(i)
      if (child?.type === "method_definition") {
        firstMethod = child
        break
      }
    }

    if (!firstMethod) {
      return { signature: extractNodeContent(classNode, lines), endLine: classNode.endPosition.row }
    }

    // Signature is everything before first method
    const signatureLines = lines.slice(classNode.startPosition.row, firstMethod.startPosition.row)
    return {
      signature: signatureLines.join("\n"),
      endLine: firstMethod.startPosition.row,
    }
  }

  /**
   * Chunk a class into multiple chunks: signature + properties, then individual methods
   */
  function chunkClass(classNode: SyntaxNode, lines: string[], filePath: string): Chunking.Chunk[] {
    const chunks: Chunking.Chunk[] = []
    const className = extractNodeName(classNode)
    const isExported = classNode.parent?.type === "export_statement"
    const classMetadata = extractMetadata(classNode, filePath)

    // Find all methods
    let classBody: SyntaxNode | null = null
    for (let i = 0; i < classNode.childCount; i++) {
      const child = classNode.child(i)
      if (child?.type === "class_body") {
        classBody = child
        break
      }
    }

    if (!classBody) {
      // No body, return whole class
      return [
        {
          content: addContextPrefix(
            extractNodeContent(classNode, lines),
            filePath,
            "class_declaration",
            className,
            isExported,
          ),
          startLine: classNode.startPosition.row + 1,
          endLine: classNode.endPosition.row + 1,
          type: "code",
          ...classMetadata,
        },
      ]
    }

    // Collect methods
    const methods: SyntaxNode[] = []
    for (let i = 0; i < classBody.childCount; i++) {
      const child = classBody.child(i)
      if (child?.type === "method_definition") {
        methods.push(child)
      }
    }

    // If class is small, keep it whole
    const classContent = extractNodeContent(classNode, lines)
    if (classContent.length <= MAX_CHUNK_SIZE || methods.length === 0) {
      return [
        {
          content: addContextPrefix(classContent, filePath, "class_declaration", className, isExported),
          startLine: classNode.startPosition.row + 1,
          endLine: classNode.endPosition.row + 1,
          type: "code",
          ...classMetadata,
        },
      ]
    }

    // Chunk 1: Class signature + properties (everything before first method)
    const { signature, endLine } = extractClassSignature(classNode, lines)
    chunks.push({
      content: addContextPrefix(signature, filePath, "class_declaration", className, isExported),
      startLine: classNode.startPosition.row + 1,
      endLine: endLine + 1,
      type: "code",
      ...classMetadata,
    })

    // Chunks 2+: Individual methods with class context
    for (const method of methods) {
      const methodName = extractNodeName(method)
      const methodContent = extractNodeContent(method, lines)
      const methodMetadata = extractMetadata(method, filePath, className)

      // Add class context to method
      const contextualContent = `// Class: ${className}\n\n${methodContent}`

      chunks.push({
        content: addContextPrefix(contextualContent, filePath, "method_definition", methodName, false),
        startLine: method.startPosition.row + 1,
        endLine: method.endPosition.row + 1,
        type: "code",
        ...methodMetadata,
      })
    }

    return chunks
  }

  /**
   * Split a large node (> MAX_CHUNK_SIZE) into multiple chunks
   */
  function splitLargeNode(node: SyntaxNode, lines: string[], filePath: string): Chunking.Chunk[] {
    // Special handling for classes
    if (node.type === "class_declaration") {
      return chunkClass(node, lines, filePath)
    }

    const chunks: Chunking.Chunk[] = []
    const content = extractNodeContent(node, lines)

    // If it's not that large after all, just return it
    if (content.length <= MAX_CHUNK_SIZE) {
      const range = getNodeLines(node)
      return [
        {
          content,
          startLine: range.start,
          endLine: range.end,
          type: "code",
        },
      ]
    }

    // Try to split at statement level
    const statements = getStatements(node)
    if (statements.length === 0) {
      // No statements found, force split at line boundaries
      log.warn("force splitting large node without statements", {
        filePath,
        nodeType: node.type,
        size: content.length,
      })
      return forceSplitByLines(node, lines)
    }

    // Get signature (everything before the first statement)
    // For namespaces, include the namespace declaration line
    const firstStmt = statements[0]
    const signatureEndLine = firstStmt.startPosition.row - 1 // Line before first statement
    const signatureLines = lines.slice(node.startPosition.row, signatureEndLine + 1)
    const signature = signatureLines.join("\n")

    // Extract namespace/function name for context
    const nodeName = extractNodeName(node)
    const nodeContext = nodeName ? `// Context: ${nodeName}` : ""

    // Group statements into chunks, tracking previous statements for overlap context
    let currentGroup: SyntaxNode[] = []
    let previousStatements: SyntaxNode[] = []
    let currentSize = signature.length

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const stmtContent = extractNodeContent(stmt, lines)

      // Check if adding this statement would exceed limit
      if (currentSize + stmtContent.length > MAX_CHUNK_SIZE && currentGroup.length > 0) {
        // Create chunk from current group, passing previous statements for overlap
        const chunk = createChunkFromStatements(
          currentGroup,
          signature,
          lines,
          node.startPosition.row + 1,
          previousStatements,
        )
        if (nodeContext && chunks.length > 0) {
          chunk.content = nodeContext + "\n\n" + chunk.content
        }
        chunks.push(chunk)
        // Track previous statements for next chunk's overlap context
        previousStatements = [...previousStatements, ...currentGroup]
        // Start new group
        currentGroup = [stmt]
        currentSize = signature.length + stmtContent.length
      } else {
        currentGroup.push(stmt)
        currentSize += stmtContent.length
      }
    }

    // Don't forget last group
    if (currentGroup.length > 0) {
      chunks.push(
        createChunkFromStatements(currentGroup, signature, lines, node.startPosition.row + 1, previousStatements),
      )
    }

    // Add closing brace to last chunk if exists
    const lastChunk = chunks[chunks.length - 1]
    const closingLine = lines[node.endPosition.row]
    if (closingLine && closingLine.trim() === "}") {
      lastChunk.content += "\n" + closingLine
      lastChunk.endLine = node.endPosition.row + 1
    }

    log.info("split large node", {
      filePath,
      nodeType: node.type,
      originalSize: content.length,
      chunks: chunks.length,
    })

    return chunks
  }

  /**
   * Extract overlap context from previous statements
   * Returns a comment block summarizing the last N statements
   */
  function extractOverlapContext(
    previousStatements: SyntaxNode[],
    lines: string[],
    count: number = STATEMENT_OVERLAP,
  ): string {
    if (previousStatements.length === 0) return ""

    const stmtsToInclude = previousStatements.slice(-count)
    const summaries: string[] = []

    for (const stmt of stmtsToInclude) {
      // Get first line of each statement (trimmed) as context
      const firstLine = lines[stmt.startPosition.row]?.trim()
      if (firstLine && firstLine.length > 0) {
        // Truncate long lines
        const truncated = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine
        summaries.push(truncated)
      }
    }

    if (summaries.length === 0) return ""

    return `// ... previous:\n${summaries.map((s) => `//   ${s}`).join("\n")}\n`
  }

  /**
   * Create a chunk from a group of statements (with signature context)
   */
  function createChunkFromStatements(
    statements: SyntaxNode[],
    signature: string,
    lines: string[],
    _signatureStartLine: number,
    previousStatements: SyntaxNode[] = [],
  ): Chunking.Chunk {
    const firstStmt = statements[0]
    const lastStmt = statements[statements.length - 1]

    // Build content: signature + overlap context + statements
    const stmtLines = lines.slice(firstStmt.startPosition.row, lastStmt.endPosition.row + 1)
    const overlapContext = extractOverlapContext(previousStatements, lines)
    const content = signature + "\n" + overlapContext + stmtLines.join("\n")

    return {
      content,
      startLine: firstStmt.startPosition.row + 1, // Use actual statement start line
      endLine: lastStmt.endPosition.row + 1,
      type: "code",
    }
  }

  /**
   * Force split by line boundaries (fallback for unparseable code)
   */
  function forceSplitByLines(node: SyntaxNode, lines: string[]): Chunking.Chunk[] {
    const chunks: Chunking.Chunk[] = []
    const range = getNodeLines(node)
    const nodeLines = lines.slice(range.start - 1, range.end)

    let currentLines: string[] = []
    let currentStartLine = range.start

    for (let i = 0; i < nodeLines.length; i++) {
      currentLines.push(nodeLines[i])
      const currentContent = currentLines.join("\n")

      if (currentContent.length > MAX_CHUNK_SIZE) {
        // Create chunk
        chunks.push({
          content: currentContent,
          startLine: currentStartLine,
          endLine: currentStartLine + currentLines.length - 1,
          type: "code",
        })
        // Reset
        currentLines = []
        currentStartLine = currentStartLine + currentLines.length
      }
    }

    // Last chunk
    if (currentLines.length > 0) {
      chunks.push({
        content: currentLines.join("\n"),
        startLine: currentStartLine,
        endLine: range.end,
        type: "code",
      })
    }

    return chunks
  }

  /**
   * Check if a declaration is small and should be merged with next chunk
   */
  function isSmallDeclaration(chunk: Chunking.Chunk): boolean {
    const SMALL_DECLARATION_THRESHOLD = 200 // chars
    if (chunk.content.length > SMALL_DECLARATION_THRESHOLD) return false

    // Check if it's a variable/const declaration
    const hasDeclaration = /^\/\/ File:.*\n\/\/ Type: (lexical_declaration|variable_declaration)/m.test(chunk.content)
    return hasDeclaration
  }

  /**
   * Check if chunk references identifiers from another chunk
   */
  function referencesDeclaration(chunk: Chunking.Chunk, declaration: Chunking.Chunk): boolean {
    // Extract identifier name from declaration
    const nameMatch = declaration.content.match(/^\/\/ Name: (.+)$/m)
    if (!nameMatch) return false

    const declName = nameMatch[1]
    // Check if the identifier appears in the chunk (simple heuristic)
    return chunk.content.includes(declName)
  }

  /**
   * Merge small declarations with the chunks that use them
   */
  function mergeSmallDeclarations(chunks: Chunking.Chunk[]): Chunking.Chunk[] {
    const result: Chunking.Chunk[] = []

    for (let i = 0; i < chunks.length; i++) {
      const current = chunks[i]

      // Check if current is a small declaration and has a next chunk
      if (isSmallDeclaration(current) && i < chunks.length - 1) {
        const next = chunks[i + 1]

        // If next chunk references this declaration, merge them
        if (referencesDeclaration(next, current)) {
          // Extract the declaration code (without prefix)
          const declContent = current.content.replace(
            /^\/\/ File:.*\n\/\/ Type:.*\n(\/\/ Name:.*\n)?(\/\/ Exported:.*\n)?\n/,
            "",
          )

          // Merge into next chunk (after its prefix)
          const nextPrefixMatch = next.content.match(
            /^(\/\/ File:.*\n\/\/ Type:.*\n(\/\/ Name:.*\n)?(\/\/ Exported:.*\n)?)\n/,
          )
          if (nextPrefixMatch) {
            const prefix = nextPrefixMatch[1]
            const restContent = next.content.slice(nextPrefixMatch[0].length)
            next.content = `${prefix}\n\n${declContent}\n\n${restContent}`
            next.startLine = Math.min(current.startLine, next.startLine)
          }

          // Skip adding current to result (it's merged)
          continue
        }
      }

      result.push(current)
    }

    return result
  }

  /**
   * Parsed import information
   */
  type ParsedImport = {
    line: string // Full import line
    identifiers: string[] // Imported identifiers (e.g., ["Tool", "ToolContext"])
    module: string // Module path (e.g., "./tool")
    isDefault: boolean // Is this a default import?
    isNamespace: boolean // Is this a namespace import (import * as X)?
  }
  /**
   * Parse import statements and extract identifiers
   */
  function parseImports(lines: string[], importEndLine: number): ParsedImport[] {
    const imports: ParsedImport[] = []

    for (let i = 0; i < importEndLine; i++) {
      const line = lines[i]
      if (!line.trim().startsWith("import")) continue

      // Handle multi-line imports by joining lines until we find the closing
      let fullImport = line
      let j = i
      while (!fullImport.includes("from") && j < importEndLine - 1) {
        j++
        fullImport += " " + lines[j].trim()
      }

      const parsed = parseImportLine(fullImport)
      if (parsed) {
        imports.push(parsed)
      }
    }

    return imports
  }

  /**
   * Parse a single import line
   */
  function parseImportLine(line: string): ParsedImport | null {
    const identifiers: string[] = []
    let module = ""
    let isDefault = false
    let isNamespace = false

    // Extract module path
    const moduleMatch = line.match(/from\s+["']([^"']+)["']/)
    if (moduleMatch) {
      module = moduleMatch[1]
    } else {
      // Side-effect import: import "module"
      const sideEffectMatch = line.match(/import\s+["']([^"']+)["']/)
      if (sideEffectMatch) {
        return {
          line: line.trim(),
          identifiers: [],
          module: sideEffectMatch[1],
          isDefault: false,
          isNamespace: false,
        }
      }
      return null
    }

    // Extract default import: import Foo from "module" or import z from "zod"
    // Match identifier that is NOT followed by comma or curly brace (to avoid matching "import type")
    const defaultMatch = line.match(/import\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+from/)
    if (defaultMatch && !line.includes("{") && !line.includes("*")) {
      identifiers.push(defaultMatch[1])
      isDefault = true
    }

    // Extract default import with alias: import Foo, { ... } from "module"
    const defaultWithNamedMatch = line.match(/import\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*\{/)
    if (defaultWithNamedMatch) {
      identifiers.push(defaultWithNamedMatch[1])
      isDefault = true
    }

    // Extract namespace import: import * as Foo from "module"
    const namespaceMatch = line.match(/import\s+\*\s+as\s+(\w+)/)
    if (namespaceMatch) {
      identifiers.push(namespaceMatch[1])
      isNamespace = true
    }

    // Extract named imports: import { Foo, Bar as Baz } from "module"
    const namedMatch = line.match(/\{([^}]+)\}/)
    if (namedMatch) {
      const names = namedMatch[1].split(",")
      for (const name of names) {
        const trimmed = name.trim()
        // Handle "Foo as Bar" - use the alias (Bar)
        const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/)
        if (aliasMatch) {
          identifiers.push(aliasMatch[2])
        } else if (trimmed) {
          identifiers.push(trimmed)
        }
      }
    }

    // Extract type imports: import type { Foo } from "module"
    // Already handled by the named match above

    return {
      line: line.trim(),
      identifiers,
      module,
      isDefault,
      isNamespace,
    }
  }

  /**
   * Find which imports are used in a chunk's content
   */
  function findRelevantImports(content: string, allImports: ParsedImport[]): string[] {
    const relevantLines: string[] = []

    for (const imp of allImports) {
      // Side-effect imports are always included if there are no identifiers
      if (imp.identifiers.length === 0) {
        continue // Skip side-effect imports for individual chunks
      }

      // Check if any identifier from this import is used in the content
      const isUsed = imp.identifiers.some((id) => {
        // Match whole word only (not substring)
        const regex = new RegExp(`\\b${id}\\b`)
        return regex.test(content)
      })

      if (isUsed) {
        relevantLines.push(imp.line)
      }
    }

    return relevantLines
  }

  /**
   * Walk AST and create chunks at appropriate boundaries
   */
  function chunkAst(tree: Tree, lines: string[], filePath: string): Chunking.Chunk[] {
    const chunks: Chunking.Chunk[] = []
    const rootNode = tree.rootNode as unknown as SyntaxNode

    // Track imports separately - now we parse them properly
    const importLines: string[] = []
    let importEndLine = 0

    // Collect top-level boundaries
    const cursor = rootNode.walk()
    cursor.gotoFirstChild()

    do {
      const node = cursor.currentNode()

      // Collect import lines
      if (node.type === "import_statement") {
        importEndLine = node.endPosition.row + 1
        const nodeLines = lines.slice(node.startPosition.row, node.endPosition.row + 1)
        importLines.push(...nodeLines)
        continue
      }

      // Check if this is a chunk boundary
      if (isChunkBoundary(node)) {
        // Extract content with JSDoc/comments
        const extracted = extractNodeWithContext(node, lines, filePath)

        // Skip only truly empty nodes
        if (!extracted.content.trim()) {
          continue
        }

        // Check if node is exported (either it's an export_statement or parent is)
        const isExported = node.type === "export_statement" || node.parent?.type === "export_statement"
        const nodeName = extractNodeName(node)
        const metadata = extractMetadata(node, filePath)

        // Add context prefix
        let finalContent = addContextPrefix(extracted.content, filePath, node.type, nodeName, isExported)

        // Use adaptive chunk size based on complexity
        const adaptiveMaxSize = getMaxChunkSize(node)

        // If too large, split it
        if (finalContent.length > adaptiveMaxSize) {
          // For large nodes, we need to split but keep the prefix
          const splitChunks = splitLargeNode(node, lines, filePath)
          // Add prefix only to first chunk of split
          if (splitChunks.length > 0) {
            splitChunks[0].content = addContextPrefix(splitChunks[0].content, filePath, node.type, nodeName, isExported)
            // Add metadata to all split chunks
            for (const splitChunk of splitChunks) {
              Object.assign(splitChunk, metadata)
            }
          }
          chunks.push(...splitChunks)
        } else {
          // Keep all meaningful declarations
          chunks.push({
            content: finalContent,
            startLine: extracted.actualStartLine,
            endLine: node.endPosition.row + 1,
            type: "code",
            ...metadata,
          })
        }
      }
    } while (cursor.gotoNextSibling())

    // Parse all imports once
    const allImports = parseImports(importLines, importLines.length)

    // Post-process: add relevant imports to each chunk, then merge small declarations
    const chunksWithImports = addRelevantImportsToChunks(chunks, allImports)
    return mergeSmallDeclarations(chunksWithImports)
  }

  /**
   * Add relevant imports to each chunk based on what identifiers it uses
   */
  function addRelevantImportsToChunks(chunks: Chunking.Chunk[], allImports: ParsedImport[]): Chunking.Chunk[] {
    return chunks.map((chunk) => {
      const relevantImports = findRelevantImports(chunk.content, allImports)

      if (relevantImports.length === 0) {
        return chunk
      }

      // Find where to insert imports (after the context prefix)
      const prefixMatch = chunk.content.match(
        /^(\/\/ File:.*\n(?:\/\/ (?:Type|Name|Exported|Keywords|Context):.*\n)*)\n?/,
      )
      if (prefixMatch) {
        const prefix = prefixMatch[1]
        const rest = chunk.content.slice(prefixMatch[0].length)
        return {
          ...chunk,
          content: `${prefix}\n${relevantImports.join("\n")}\n\n${rest}`,
        }
      }

      // No prefix found, add imports at the beginning
      return {
        ...chunk,
        content: `${relevantImports.join("\n")}\n\n${chunk.content}`,
      }
    })
  }

  /**
   * Build test context path (describe > it chain)
   */
  function buildTestContext(node: SyntaxNode, lines: string[]): string {
    const contexts: string[] = []
    let current: SyntaxNode | null = node

    // Walk up the tree to find describe/it blocks
    while (current) {
      if (current.type === "call_expression") {
        // Check if it's describe or it
        const callee = current.childForFieldName("function")
        if (callee && (callee.text === "describe" || callee.text === "it" || callee.text === "test")) {
          // Get the first argument (test name)
          const args = current.childForFieldName("arguments")
          if (args && args.childCount > 1) {
            const firstArg = args.child(1) // Skip opening paren
            if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
              contexts.unshift(firstArg.text.replace(/^["'`]|["'`]$/g, ""))
            }
          }
        }
      }
      current = current.parent
    }

    return contexts.join(" > ")
  }

  /**
   * Check if file is a test file
   */
  function isTestFile(filePath: string): boolean {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)
  }

  /**
   * Chunk test file with describe/it context
   */
  function chunkTestFile(tree: Tree, lines: string[], filePath: string): Chunking.Chunk[] {
    const chunks: Chunking.Chunk[] = []
    const rootNode = tree.rootNode as unknown as SyntaxNode

    // Find all test blocks (describe, it, test)
    const findTestBlocks = (node: SyntaxNode): SyntaxNode[] => {
      const blocks: SyntaxNode[] = []

      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function")
        if (callee && (callee.text === "describe" || callee.text === "it" || callee.text === "test")) {
          blocks.push(node)
        }
      }

      // Recurse to children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) {
          blocks.push(...findTestBlocks(child))
        }
      }

      return blocks
    }

    const testBlocks = findTestBlocks(rootNode)

    // Create chunks for each test block
    for (const block of testBlocks) {
      const context = buildTestContext(block, lines)
      const content = extractNodeContent(block, lines)

      if (!content.trim()) continue

      // Add test context prefix
      const contextualContent = `// Test: ${context}\n\n${content}`

      chunks.push({
        content: addContextPrefix(contextualContent, filePath, "test", context, false),
        startLine: block.startPosition.row + 1,
        endLine: block.endPosition.row + 1,
        type: "code",
      })
    }

    return chunks
  }

  /**
   * Main entry point: chunk a TypeScript/JavaScript file using tree-sitter
   */
  export async function chunk(content: string, filePath: string): Promise<Chunking.Chunk[]> {
    // Select parser based on file extension
    const isTSX = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    const parser = isTSX ? await tsxParser() : await tsParser()

    // Parse the file
    const tree = parser.parse(content)

    // Handle parse failure
    if (!tree) {
      log.warn("tree-sitter failed to parse file", { filePath })
      return []
    }

    // Check for parse errors
    const hasError =
      typeof (tree.rootNode as any).hasError === "function"
        ? (tree.rootNode as any).hasError()
        : (tree.rootNode as any).hasError
    if (hasError) {
      log.warn("tree-sitter parse errors detected", { filePath })
      // Continue anyway - tree-sitter is error-tolerant
    }

    // Split content into lines for extraction
    const lines = content.split("\n")

    // Special handling for test files
    let chunks: Chunking.Chunk[]
    if (isTestFile(filePath)) {
      chunks = chunkTestFile(tree, lines, filePath)
      log.info("chunked test file", { filePath, testBlocks: chunks.length })
    } else {
      // Walk AST and create chunks
      chunks = chunkAst(tree, lines, filePath)
    }

    log.info("chunked file with tree-sitter", {
      filePath,
      chunks: chunks.length,
      avgSize: Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / (chunks.length || 1)),
    })

    return chunks
  }
}
