/**
 * TypeScript/JavaScript Language Support
 *
 * Implements LanguageSupport interface for TypeScript and JavaScript files.
 * Handles .ts, .tsx, .js, .jsx extensions.
 */

import type { SyntaxNode } from "web-tree-sitter"
import { createRequire } from "module"
import { lazy } from "../../util/lazy.js"
import type {
  LanguageSupport,
  ChunkMetadata,
  SemanticSymbolType,
  SymbolVariant,
  LanguageVariantDef,
} from "./types.js"

const require = createRequire(import.meta.url)
const resolveWasmPath = (id: string) => require.resolve(id)

// ============================================================================
// Parser Initialization (Lazy-loaded)
// ============================================================================

const initParser = async (wasmName: string) => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const treePath = resolveWasmPath("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const langPath = resolveWasmPath(`tree-sitter-wasms/out/${wasmName}`)
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const language = await Language.load(langPath)
  const p = new Parser()
  p.setLanguage(language)
  return p
}

/** Lazy-loaded TypeScript parser */
export const tsParser = lazy(() => initParser("tree-sitter-typescript.wasm"))

/** Lazy-loaded TSX parser */
export const tsxParser = lazy(() => initParser("tree-sitter-tsx.wasm"))

// ============================================================================
// Reserved Words (for duplicate detector normalization)
// ============================================================================

const TYPESCRIPT_RESERVED_WORDS = new Set([
  // JavaScript keywords
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with",
  // ES6+ keywords
  "class", "const", "export", "extends", "import", "super", "let", "yield",
  "async", "await", "static",
  // TypeScript keywords
  "abstract", "any", "as", "asserts", "bigint", "boolean", "declare",
  "enum", "implements", "infer", "interface", "is", "keyof", "module",
  "namespace", "never", "number", "object", "private", "protected",
  "public", "readonly", "require", "string", "symbol", "type", "undefined",
  "unique", "unknown", "from", "of", "get", "set", "constructor",
  // Literals
  "true", "false", "null",
])

// ============================================================================
// AST Node Types
// ============================================================================

/** Node types that define chunk boundaries */
const CHUNK_BOUNDARY_TYPES = [
  "function_declaration",
  "function_signature",
  "method_definition",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "module",
  "internal_module",
  "lexical_declaration",
  "variable_declaration",
] as const

/** Node types that increase cyclomatic complexity */
const COMPLEXITY_NODE_TYPES = [
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "case",
  "catch_clause",
  "conditional_expression", // ternary
  "binary_expression", // && and || add complexity
] as const

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a lexical declaration contains an arrow function
 */
function isArrowFunctionDeclaration(node: SyntaxNode): boolean {
  if (node.type !== "lexical_declaration" && node.type !== "variable_declaration") {
    return false
  }

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
 * Check if a function/method has async keyword
 */
function hasAsyncKeyword(node: SyntaxNode): boolean {
  // Check for async keyword in function declarations
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "async") {
      return true
    }
  }

  // For arrow functions in variable declarations
  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "variable_declarator") {
        for (let j = 0; j < child.childCount; j++) {
          const valueNode = child.child(j)
          if (valueNode?.type === "arrow_function") {
            // Check if arrow function has async
            for (let k = 0; k < valueNode.childCount; k++) {
              if (valueNode.child(k)?.type === "async") {
                return true
              }
            }
          }
        }
      }
    }
  }

  return false
}

/**
 * Check if a method is static
 */
function hasStaticKeyword(node: SyntaxNode): boolean {
  if (node.type !== "method_definition") return false

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "static") {
      return true
    }
  }
  return false
}

/**
 * Check if a class or method is abstract
 */
function hasAbstractKeyword(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "abstract") {
      return true
    }
  }
  return false
}

/**
 * Check if a method is a getter or setter
 */
function getAccessorType(node: SyntaxNode): "get" | "set" | undefined {
  if (node.type !== "method_definition") return undefined

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "get") return "get"
    if (child?.type === "set") return "set"
  }
  return undefined
}

/**
 * Check if node has JSDoc or leading comments
 */
function hasJSDoc(node: SyntaxNode): boolean {
  // Check node text for JSDoc pattern
  const nodeText = node.text
  return /\/\*\*/.test(nodeText) || /^\/\//.test(nodeText)
}

// ============================================================================
// TypeScript Language Support Implementation
// ============================================================================

export const TypeScriptLanguage: LanguageSupport = {
  id: "typescript",
  displayName: "TypeScript",
  extensions: [".ts", ".tsx"],
  parserWasm: "tree-sitter-typescript.wasm",
  reservedWords: TYPESCRIPT_RESERVED_WORDS,

  variants: [
    { name: "interface", description: "Interface declaration", category: "type" },
    { name: "alias", description: "Type alias (type X = ...)", category: "type" },
    { name: "enum", description: "Enum declaration", category: "type" },
    { name: "namespace", description: "Namespace/module", category: "type" },
    { name: "async", description: "Async function/method", category: "modifier" },
    { name: "static", description: "Static method", category: "modifier" },
    { name: "abstract", description: "Abstract class/method", category: "modifier" },
    { name: "arrow", description: "Arrow function", category: "modifier" },
    { name: "generator", description: "Generator function", category: "modifier" },
  ],

  decorators: [], // TypeScript decorators are experimental

  isChunkBoundary(node: SyntaxNode): boolean {
    if (CHUNK_BOUNDARY_TYPES.includes(node.type as any)) {
      // For lexical declarations, only treat as boundary if at top level
      if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        const parent = node.parent
        if (parent?.type === "export_statement" || parent?.type === "program") {
          return true
        }
        return false
      }
      return true
    }

    // Export statements can be boundaries if they contain declarations
    if (node.type === "export_statement") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && CHUNK_BOUNDARY_TYPES.includes(child.type as any)) {
          return true
        }
      }
    }

    return false
  },

  shouldSkipNode(node: SyntaxNode): boolean {
    // Skip import statements (handled separately)
    return node.type === "import_statement"
  },

  extractMetadata(node: SyntaxNode, _content: string, filePath: string): ChunkMetadata {
    const symbolName = this.extractNodeName(node)
    const symbolType = this.nodeToSymbolType(node)
    const variant = this.nodeToVariant(node)
    const complexity = this.calculateComplexity(node)
    const isExported = this.isExported(node)
    const isAsync = this.isAsync(node)
    const isStatic = this.isStatic(node)
    const isAbstract = this.isAbstract(node)
    const decorators = this.extractDecorators(node)
    const hasDocumentation = this.hasDocumentation(node)
    const parentScope = this.getParentScope(node)

    // Determine language variant
    const language = filePath.endsWith(".ts") || filePath.endsWith(".tsx")
      ? "typescript" as const
      : "javascript" as const

    return {
      symbolName,
      symbolType: symbolType || "variable",
      variant,
      language,
      isExported,
      isAsync,
      isStatic,
      isAbstract,
      decorators,
      complexity,
      hasDocumentation,
      parentScope,
    }
  },

  extractNodeName(node: SyntaxNode): string | undefined {
    // Try to find identifier child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "identifier" || child?.type === "type_identifier") {
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
      // For variable declarations with arrow functions
      if (child?.type === "variable_declarator") {
        for (let j = 0; j < child.childCount; j++) {
          const varChild = child.child(j)
          if (varChild?.type === "identifier") {
            return varChild.text
          }
        }
      }
    }
    return undefined
  },

  calculateComplexity(node: SyntaxNode): number {
    let score = 0

    const walk = (n: SyntaxNode) => {
      if (COMPLEXITY_NODE_TYPES.includes(n.type as any)) {
        // switch_statement counts as 2
        score += n.type === "switch_statement" ? 2 : 1
      }
      // Count && and || operators
      if (n.type === "binary_expression") {
        const operator = n.child(1)?.text
        if (operator === "&&" || operator === "||") {
          score += 1
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)
    return score
  },

  isExported(node: SyntaxNode): boolean {
    return node.parent?.type === "export_statement" || node.type === "export_statement"
  },

  isAsync(node: SyntaxNode): boolean {
    return hasAsyncKeyword(node)
  },

  isStatic(node: SyntaxNode): boolean {
    return hasStaticKeyword(node)
  },

  isAbstract(node: SyntaxNode): boolean {
    return hasAbstractKeyword(node)
  },

  extractDecorators(node: SyntaxNode): string[] {
    const decorators: string[] = []

    // Look for decorator nodes before the declaration
    let sibling = node.parent?.child(0)
    while (sibling && sibling !== node) {
      if (sibling.type === "decorator") {
        decorators.push(sibling.text)
      }
      // Move to next sibling
      const idx = Array.from({ length: node.parent?.childCount || 0 })
        .findIndex((_, i) => node.parent?.child(i) === sibling)
      sibling = node.parent?.child(idx + 1) || null
    }

    return decorators
  },

  hasDocumentation(node: SyntaxNode): boolean {
    return hasJSDoc(node)
  },

  getParentScope(node: SyntaxNode): string | undefined {
    let parent = node.parent
    while (parent) {
      if (parent.type === "class_declaration" || parent.type === "class") {
        // Find the class name
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i)
          if (child?.type === "identifier" || child?.type === "type_identifier") {
            return child.text
          }
        }
      }
      if (parent.type === "internal_module" || parent.type === "module") {
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i)
          if (child?.type === "identifier") {
            return child.text
          }
        }
      }
      parent = parent.parent
    }
    return undefined
  },

  getNodeTypes(symbolType: SemanticSymbolType, variant?: string): readonly string[] {
    switch (symbolType) {
      case "function":
        if (variant === "async") {
          return ["function_declaration", "arrow_function"] // filtered by isAsync
        }
        if (variant === "generator") {
          return ["generator_function_declaration"]
        }
        if (variant === "arrow") {
          return ["arrow_function"]
        }
        return ["function_declaration", "function_signature", "arrow_function"]

      case "class":
        if (variant === "abstract") {
          return ["class_declaration"] // filtered by isAbstract
        }
        return ["class_declaration"]

      case "method":
        if (variant === "static") {
          return ["method_definition"] // filtered by isStatic
        }
        if (variant === "property") {
          return ["method_definition"] // filtered by accessor type
        }
        return ["method_definition"]

      case "type":
        if (variant === "interface") {
          return ["interface_declaration"]
        }
        if (variant === "alias") {
          return ["type_alias_declaration"]
        }
        return ["interface_declaration", "type_alias_declaration"]

      case "variable":
        if (variant === "constant") {
          return ["lexical_declaration"] // filtered by const keyword
        }
        return ["lexical_declaration", "variable_declaration"]

      case "enum":
        return ["enum_declaration"]

      case "module":
        return ["module", "internal_module"]

      default:
        return []
    }
  },

  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined {
    switch (node.type) {
      case "function_declaration":
      case "function_signature":
        return "function"

      case "class_declaration":
        return "class"

      case "method_definition":
        return "method"

      case "interface_declaration":
        return "type"

      case "type_alias_declaration":
        return "type"

      case "enum_declaration":
        return "enum"

      case "internal_module":
      case "module":
        return "module"

      case "lexical_declaration":
      case "variable_declaration":
        // Arrow functions are functions, not variables
        if (isArrowFunctionDeclaration(node)) {
          return "function"
        }
        return "variable"

      case "export_statement":
        // Delegate to child
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) {
            const childType = this.nodeToSymbolType(child)
            if (childType) return childType
          }
        }
        return undefined

      default:
        return undefined
    }
  },

  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined {
    const symbolType = this.nodeToSymbolType(node)

    switch (symbolType) {
      case "function":
        if (hasAsyncKeyword(node)) return "async"
        if (isArrowFunctionDeclaration(node)) return "arrow"
        return undefined

      case "class":
        if (hasAbstractKeyword(node)) return "abstract"
        return undefined

      case "method":
        if (hasStaticKeyword(node)) return "static"
        const accessor = getAccessorType(node)
        if (accessor) return "property"
        if (hasAbstractKeyword(node)) return "abstract"
        return undefined

      case "type":
        if (node.type === "interface_declaration") return "interface"
        if (node.type === "type_alias_declaration") return "alias"
        return undefined

      case "variable":
        // Check if it's a const (constant)
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child?.type === "const") {
            // Check if name is UPPER_CASE
            const name = this.extractNodeName(node)
            if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) {
              return "constant"
            }
          }
        }
        return undefined

      default:
        return undefined
    }
  },
}

// ============================================================================
// JavaScript Language Support (extends TypeScript)
// ============================================================================

export const JavaScriptLanguage: LanguageSupport = {
  ...TypeScriptLanguage,
  id: "javascript",
  displayName: "JavaScript",
  extensions: [".js", ".jsx"],
  parserWasm: "tree-sitter-javascript.wasm",

  // JavaScript doesn't have interfaces, type aliases, etc.
  variants: [
    { name: "async", description: "Async function/method", category: "modifier" },
    { name: "static", description: "Static method", category: "modifier" },
    { name: "arrow", description: "Arrow function", category: "modifier" },
    { name: "generator", description: "Generator function", category: "modifier" },
  ],

  extractMetadata(node: SyntaxNode, content: string, filePath: string): ChunkMetadata {
    const metadata = TypeScriptLanguage.extractMetadata.call(this, node, content, filePath)
    return {
      ...metadata,
      language: "javascript",
    }
  },
}
