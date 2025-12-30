/**
 * Python Language Support
 *
 * Implements LanguageSupport interface for Python files.
 * Handles .py extension.
 */

import type { SyntaxNode } from "web-tree-sitter"
import { createRequire } from "module"
import { lazy } from "../../util/lazy.js"
import type { Chunking } from "../chunking.js"
import type {
  LanguageSupport,
  ChunkMetadata,
  SemanticSymbolType,
  SymbolVariant,
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

/** Lazy-loaded Python parser */
export const pythonParser = lazy(() => initParser("tree-sitter-python.wasm"))

// ============================================================================
// Reserved Words (for duplicate detector normalization)
// ============================================================================

const PYTHON_RESERVED_WORDS = new Set([
  // Keywords
  "False", "None", "True", "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
  "while", "with", "yield",
  // Built-in functions (commonly used)
  "print", "len", "range", "str", "int", "float", "list", "dict", "set",
  "tuple", "bool", "type", "isinstance", "hasattr", "getattr", "setattr",
  "open", "super", "self", "cls",
  // Common type hints
  "Optional", "List", "Dict", "Set", "Tuple", "Any", "Union", "Callable",
])

// ============================================================================
// AST Node Types
// ============================================================================

/** Node types that define chunk boundaries */
const CHUNK_BOUNDARY_TYPES = [
  "function_definition",
  "class_definition",
  "decorated_definition",
] as const

/** Node types that increase cyclomatic complexity */
const COMPLEXITY_NODE_TYPES = [
  "if_statement",
  "for_statement",
  "while_statement",
  "try_statement",
  "except_clause",
  "with_statement",
  "match_statement", // Python 3.10+
  "case_clause",
  "conditional_expression", // ternary: x if cond else y
  "boolean_operator", // and, or
  "list_comprehension",
  "dictionary_comprehension",
  "set_comprehension",
  "generator_expression",
] as const

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a function has async keyword
 */
function isAsyncFunction(node: SyntaxNode): boolean {
  // Check for "async" keyword before "def"
  if (node.type === "function_definition") {
    // Check parent for decorated_definition
    const parent = node.parent
    if (parent?.type === "decorated_definition") {
      // Look for async in parent's children before the function
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i)
        if (child?.type === "async") return true
        if (child === node) break
      }
    }
    // Check direct children for async
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "async") return true
    }
  }

  // Check for async in decorated_definition
  if (node.type === "decorated_definition") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "async") return true
      if (child?.type === "function_definition") {
        return isAsyncFunction(child)
      }
    }
  }

  return false
}

/**
 * Extract decorators from a node
 */
function getDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = []

  if (node.type === "decorated_definition") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "decorator") {
        // Get the decorator name (e.g., "@property" or "@dataclass")
        let decoratorText = child.text
        // Normalize: keep only the decorator name without arguments
        const match = decoratorText.match(/@(\w+)/)
        if (match) {
          decorators.push(`@${match[1]}`)
        } else {
          decorators.push(decoratorText)
        }
      }
    }
  }

  return decorators
}

/**
 * Check if method has @staticmethod decorator
 */
function isStaticMethod(node: SyntaxNode): boolean {
  const decorators = getDecorators(node.parent?.type === "decorated_definition" ? node.parent : node)
  return decorators.some(d => d === "@staticmethod")
}

/**
 * Check if method has @classmethod decorator
 */
function isClassMethod(node: SyntaxNode): boolean {
  const decorators = getDecorators(node.parent?.type === "decorated_definition" ? node.parent : node)
  return decorators.some(d => d === "@classmethod")
}

/**
 * Check if method has @property decorator
 */
function isPropertyMethod(node: SyntaxNode): boolean {
  const decorators = getDecorators(node.parent?.type === "decorated_definition" ? node.parent : node)
  return decorators.some(d => d === "@property" || d.includes("setter") || d.includes("getter"))
}

/**
 * Check if method has @abstractmethod decorator
 */
function isAbstractMethod(node: SyntaxNode): boolean {
  const decorators = getDecorators(node.parent?.type === "decorated_definition" ? node.parent : node)
  return decorators.some(d => d === "@abstractmethod" || d === "@abc.abstractmethod")
}

/**
 * Check if class has @dataclass decorator
 */
function isDataclass(node: SyntaxNode): boolean {
  const decorators = getDecorators(node.parent?.type === "decorated_definition" ? node.parent : node)
  return decorators.some(d => d === "@dataclass" || d === "@dataclasses.dataclass")
}

/**
 * Check if class is abstract (inherits from ABC)
 */
function isAbstractClass(node: SyntaxNode): boolean {
  // Check if class inherits from ABC
  const actualNode = node.type === "decorated_definition"
    ? node.childForFieldName("definition")
    : node

  if (actualNode?.type !== "class_definition") return false

  // Look for argument_list (base classes)
  for (let i = 0; i < actualNode.childCount; i++) {
    const child = actualNode.child(i)
    if (child?.type === "argument_list") {
      const text = child.text
      if (text.includes("ABC") || text.includes("ABCMeta")) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if class is a Protocol
 */
function isProtocol(node: SyntaxNode): boolean {
  const actualNode = node.type === "decorated_definition"
    ? node.childForFieldName("definition")
    : node

  if (actualNode?.type !== "class_definition") return false

  for (let i = 0; i < actualNode.childCount; i++) {
    const child = actualNode.child(i)
    if (child?.type === "argument_list") {
      const text = child.text
      if (text.includes("Protocol")) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if class is a TypedDict
 */
function isTypedDict(node: SyntaxNode): boolean {
  const actualNode = node.type === "decorated_definition"
    ? node.childForFieldName("definition")
    : node

  if (actualNode?.type !== "class_definition") return false

  for (let i = 0; i < actualNode.childCount; i++) {
    const child = actualNode.child(i)
    if (child?.type === "argument_list") {
      const text = child.text
      if (text.includes("TypedDict")) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if class is a NamedTuple
 */
function isNamedTuple(node: SyntaxNode): boolean {
  const actualNode = node.type === "decorated_definition"
    ? node.childForFieldName("definition")
    : node

  if (actualNode?.type !== "class_definition") return false

  for (let i = 0; i < actualNode.childCount; i++) {
    const child = actualNode.child(i)
    if (child?.type === "argument_list") {
      const text = child.text
      if (text.includes("NamedTuple")) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if class is an Enum
 */
function isEnumClass(node: SyntaxNode): boolean {
  const actualNode = node.type === "decorated_definition"
    ? node.childForFieldName("definition")
    : node

  if (actualNode?.type !== "class_definition") return false

  for (let i = 0; i < actualNode.childCount; i++) {
    const child = actualNode.child(i)
    if (child?.type === "argument_list") {
      const text = child.text
      if (text.includes("Enum") || text.includes("IntEnum") || text.includes("StrEnum")) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if node has docstring
 */
function hasDocstring(node: SyntaxNode): boolean {
  // Get the actual node (unwrap decorated_definition)
  const actualNode = node.type === "decorated_definition"
    ? (node.childForFieldName("definition") || node)
    : node

  // Look for block/body
  const body = actualNode.childForFieldName("body")
  if (!body) return false

  // First child of body that is expression_statement containing string
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i)
    if (child?.type === "expression_statement") {
      const expr = child.child(0)
      if (expr?.type === "string") {
        return true
      }
    }
    // Stop at first non-docstring statement
    if (child && child.type !== "expression_statement" && child.type !== "comment") {
      break
    }
  }

  return false
}

/**
 * Check if a symbol is "exported" (public in Python terms)
 * Python convention: names starting with _ are private
 */
function isPythonPublic(name: string | undefined): boolean {
  if (!name) return true
  return !name.startsWith("_")
}

/**
 * Check if function is inside a class (i.e., it's a method)
 */
function isInsideClass(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === "class_definition") return true
    if (parent.type === "decorated_definition") {
      // Check if decorated_definition contains a class
      for (let i = 0; i < parent.childCount; i++) {
        if (parent.child(i)?.type === "class_definition") return false
      }
    }
    parent = parent.parent
  }
  return false
}

/**
 * Get the function definition from a decorated_definition or the node itself
 */
function getFunctionNode(node: SyntaxNode): SyntaxNode | null {
  if (node.type === "function_definition") return node
  if (node.type === "decorated_definition") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "function_definition") return child
    }
  }
  return null
}

/**
 * Get the class definition from a decorated_definition or the node itself
 */
function getClassNode(node: SyntaxNode): SyntaxNode | null {
  if (node.type === "class_definition") return node
  if (node.type === "decorated_definition") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "class_definition") return child
    }
  }
  return null
}

// ============================================================================
// Python Language Support Implementation
// ============================================================================

export const PythonLanguage: LanguageSupport = {
  id: "python",
  extensions: [".py"],
  parserWasm: "tree-sitter-python.wasm",
  reservedWords: PYTHON_RESERVED_WORDS,

  isChunkBoundary(node: SyntaxNode): boolean {
    // Direct chunk boundaries
    if (CHUNK_BOUNDARY_TYPES.includes(node.type as any)) {
      // For function_definition, only top-level or class-level are boundaries
      if (node.type === "function_definition") {
        const parent = node.parent
        // Top-level function
        if (parent?.type === "module") return true
        // Class method
        if (parent?.type === "block" && parent.parent?.type === "class_definition") return true
        // Inside decorated_definition (handled by decorated_definition itself)
        if (parent?.type === "decorated_definition") return false
        return false
      }
      return true
    }
    return false
  },

  shouldSkipNode(node: SyntaxNode): boolean {
    // Skip import statements
    return node.type === "import_statement" || node.type === "import_from_statement"
  },

  extractMetadata(node: SyntaxNode, _content: string, _filePath: string): ChunkMetadata {
    const symbolName = this.extractNodeName(node)
    const symbolType = this.nodeToSymbolType(node)
    const variant = this.nodeToVariant(node)
    const complexity = this.calculateComplexity(node)
    const isExported = isPythonPublic(symbolName)
    const isAsync = this.isAsync(node)
    const isStatic = this.isStatic(node)
    const isAbstract = this.isAbstract(node)
    const decorators = this.extractDecorators(node)
    const hasDocumentation = this.hasDocumentation(node)
    const parentScope = this.getParentScope(node)

    return {
      symbolName,
      symbolType: symbolType || "variable",
      variant,
      language: "python",
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
    // Handle decorated_definition
    if (node.type === "decorated_definition") {
      const funcNode = getFunctionNode(node)
      if (funcNode) return this.extractNodeName(funcNode)
      const classNode = getClassNode(node)
      if (classNode) return this.extractNodeName(classNode)
    }

    // Look for name field or identifier
    const nameNode = node.childForFieldName("name")
    if (nameNode) return nameNode.text

    // Fallback: look for identifier
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "identifier") {
        return child.text
      }
    }

    return undefined
  },

  calculateComplexity(node: SyntaxNode): number {
    let score = 0

    const walk = (n: SyntaxNode) => {
      if (COMPLEXITY_NODE_TYPES.includes(n.type as any)) {
        score += 1
      }
      // Count "and" and "or" operators
      if (n.type === "boolean_operator") {
        score += 1
      }
      // Comprehensions with conditions add extra complexity
      if (n.type === "list_comprehension" || n.type === "dictionary_comprehension") {
        // Check for if clause inside
        for (let i = 0; i < n.childCount; i++) {
          if (n.child(i)?.type === "if_clause") {
            score += 1
          }
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
    const name = this.extractNodeName(node)
    return isPythonPublic(name)
  },

  isAsync(node: SyntaxNode): boolean {
    return isAsyncFunction(node)
  },

  isStatic(node: SyntaxNode): boolean {
    return isStaticMethod(node)
  },

  isAbstract(node: SyntaxNode): boolean {
    if (node.type === "class_definition" || (node.type === "decorated_definition" && getClassNode(node))) {
      return isAbstractClass(node)
    }
    return isAbstractMethod(node)
  },

  extractDecorators(node: SyntaxNode): string[] {
    if (node.type === "decorated_definition") {
      return getDecorators(node)
    }
    if (node.parent?.type === "decorated_definition") {
      return getDecorators(node.parent)
    }
    return []
  },

  hasDocumentation(node: SyntaxNode): boolean {
    return hasDocstring(node)
  },

  getParentScope(node: SyntaxNode): string | undefined {
    let parent = node.parent
    while (parent) {
      if (parent.type === "class_definition") {
        const nameNode = parent.childForFieldName("name")
        if (nameNode) return nameNode.text
      }
      if (parent.type === "decorated_definition") {
        const classNode = getClassNode(parent)
        if (classNode) {
          const nameNode = classNode.childForFieldName("name")
          if (nameNode) return nameNode.text
        }
      }
      parent = parent.parent
    }
    return undefined
  },

  getNodeTypes(symbolType: SemanticSymbolType, variant?: string): readonly string[] {
    switch (symbolType) {
      case "function":
        // All functions (top-level, not methods)
        return ["function_definition", "decorated_definition"]

      case "class":
        if (variant === "dataclass") {
          return ["decorated_definition"] // filtered by @dataclass decorator
        }
        if (variant === "abstract") {
          return ["class_definition", "decorated_definition"] // filtered by ABC inheritance
        }
        return ["class_definition", "decorated_definition"]

      case "method":
        // Methods are function_definition inside class
        return ["function_definition", "decorated_definition"]

      case "type":
        // Protocol, TypedDict, NamedTuple
        if (variant === "interface" || variant === "protocol") {
          return ["class_definition"] // filtered by Protocol inheritance
        }
        if (variant === "schema") {
          return ["class_definition"] // filtered by TypedDict/NamedTuple
        }
        return ["class_definition"]

      case "variable":
        // Top-level assignments
        return ["assignment", "augmented_assignment"]

      case "enum":
        return ["class_definition"] // filtered by Enum inheritance

      case "module":
        return ["module"]

      default:
        return []
    }
  },

  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined {
    // Handle decorated_definition
    if (node.type === "decorated_definition") {
      const funcNode = getFunctionNode(node)
      if (funcNode) {
        // Check if it's a method (inside class) or function
        if (isInsideClass(funcNode)) return "method"
        return "function"
      }
      const classNode = getClassNode(node)
      if (classNode) {
        // Check if it's an enum
        if (isEnumClass(node)) return "enum"
        // Check if it's a type (Protocol, TypedDict)
        if (isProtocol(node) || isTypedDict(node) || isNamedTuple(node)) return "type"
        return "class"
      }
    }

    if (node.type === "function_definition") {
      if (isInsideClass(node)) return "method"
      return "function"
    }

    if (node.type === "class_definition") {
      if (isEnumClass(node)) return "enum"
      if (isProtocol(node) || isTypedDict(node) || isNamedTuple(node)) return "type"
      return "class"
    }

    if (node.type === "assignment" || node.type === "augmented_assignment") {
      return "variable"
    }

    return undefined
  },

  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined {
    const symbolType = this.nodeToSymbolType(node)

    switch (symbolType) {
      case "function":
        if (isAsyncFunction(node)) return "async"
        // Check for generator (yield keyword in body)
        const funcNode = getFunctionNode(node) || node
        if (funcNode.text.includes("yield")) return "generator"
        return undefined

      case "class":
        if (isDataclass(node)) return "dataclass"
        if (isAbstractClass(node)) return "abstract"
        return undefined

      case "method":
        if (isStaticMethod(node)) return "static"
        if (isClassMethod(node)) return "classmethod"
        if (isPropertyMethod(node)) return "property"
        if (isAbstractMethod(node)) return "abstract"
        return undefined

      case "type":
        if (isProtocol(node)) return "interface" // Protocol maps to interface semantic
        if (isTypedDict(node)) return "schema"
        if (isNamedTuple(node)) return "schema"
        return undefined

      case "variable":
        // Check if name is UPPER_CASE (constant convention)
        const name = this.extractNodeName(node)
        if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) {
          return "constant"
        }
        return undefined

      default:
        return undefined
    }
  },
}

// ============================================================================
// Python Chunking Function
// ============================================================================

/**
 * Chunk Python code into semantic units (functions, classes, methods)
 * Similar to TreeSitterChunking.chunk but for Python
 */
export async function chunk(content: string, filePath: string): Promise<Chunking.Chunk[]> {
  const parser = await pythonParser()
  const tree = parser.parse(content)
  
  if (!tree || !tree.rootNode) {
    return []
  }

  const chunks: Chunking.Chunk[] = []
  const lines = content.split("\n")

  // Collect all chunk boundary nodes
  const boundaryNodes: SyntaxNode[] = []
  
  const collectBoundaries = (node: SyntaxNode) => {
    if (PythonLanguage.isChunkBoundary(node)) {
      boundaryNodes.push(node)
    }
    // Don't recurse into functions/classes to avoid nested boundaries
    if (!CHUNK_BOUNDARY_TYPES.includes(node.type as any)) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) collectBoundaries(child)
      }
    } else {
      // For classes, we still want to find methods inside
      if (node.type === "class_definition" || 
          (node.type === "decorated_definition" && getClassNode(node))) {
        const classBody = node.type === "class_definition" 
          ? node.childForFieldName("body")
          : getClassNode(node)?.childForFieldName("body")
        if (classBody) {
          for (let i = 0; i < classBody.childCount; i++) {
            const child = classBody.child(i)
            if (child && PythonLanguage.isChunkBoundary(child)) {
              boundaryNodes.push(child)
            }
          }
        }
      }
    }
  }

  collectBoundaries(tree.rootNode)

  // Create chunks from boundary nodes
  for (const node of boundaryNodes) {
    const startLine = node.startPosition.row + 1 // 1-indexed
    const endLine = node.endPosition.row + 1

    // Get the chunk content
    const chunkLines = lines.slice(node.startPosition.row, node.endPosition.row + 1)
    const chunkContent = chunkLines.join("\n")

    // Skip very small chunks
    if (chunkContent.length < 50) continue

    // Extract metadata
    const metadata = PythonLanguage.extractMetadata(node, content, filePath)

    chunks.push({
      content: chunkContent,
      startLine,
      endLine,
      type: "code",
      symbolName: metadata.symbolName,
      symbolType: metadata.symbolType,
      variant: metadata.variant,
      complexity: metadata.complexity,
      isExported: metadata.isExported,
      isAsync: metadata.isAsync,
      isStatic: metadata.isStatic,
      isAbstract: metadata.isAbstract,
      decorators: metadata.decorators,
      parentScope: metadata.parentScope,
      hasDocumentation: metadata.hasDocumentation,
      language: "python",
    })
  }

  return chunks
}
