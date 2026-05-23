/**
 * Java Language Support
 *
 * Implements LanguageSupport interface for Java files.
 * Handles .java extension.
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
  LanguageVariantDef,
} from "./types.js"

const require = createRequire(import.meta.url)
const resolveWasmPath = (id: string) => require.resolve(id)

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

export const javaParser = lazy(() => initParser("tree-sitter-java.wasm"))

const JAVA_RESERVED_WORDS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "record",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
  "true",
  "false",
  "null",
  "var",
])

const MIN_JAVA_CHUNK_SIZE = 20

const CHUNK_BOUNDARY_TYPES = [
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
  "method_declaration",
  "constructor_declaration",
  "field_declaration",
] as const

const COMPLEXITY_NODE_TYPES = [
  "if_statement",
  "for_statement",
  "enhanced_for_statement",
  "while_statement",
  "do_statement",
  "catch_clause",
  "switch_expression",
  "switch_block_statement_group",
  "conditional_expression",
] as const

const TYPE_DECLARATION_TYPES = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
])

const TYPE_BODY_TYPES = new Set([
  "class_body",
  "interface_body",
  "enum_body",
  "annotation_type_body",
])

const JAVA_VARIANTS: readonly LanguageVariantDef[] = [
  { name: "interface", description: "Interface declaration", category: "type" },
  { name: "annotation", description: "Annotation type declaration", category: "type" },
  { name: "record", description: "Record declaration", category: "type" },
  { name: "abstract", description: "Abstract class or method", category: "modifier" },
  { name: "static", description: "Static method", category: "modifier" },
  { name: "constant", description: "Final field", category: "modifier" },
] as const

function getModifiersNode(node: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "modifiers") return child
  }
  return null
}

function hasModifier(node: SyntaxNode, modifier: string): boolean {
  const modifiers = getModifiersNode(node)
  if (!modifiers) return false

  for (let i = 0; i < modifiers.childCount; i++) {
    if (modifiers.child(i)?.type === modifier) {
      return true
    }
  }
  return false
}

function getTypeBody(node: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && TYPE_BODY_TYPES.has(child.type)) {
      return child
    }
  }
  return null
}

function getFieldName(node: SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "variable_declarator") {
      for (let j = 0; j < child.childCount; j++) {
        const part = child.child(j)
        if (part?.type === "identifier") return part.text
      }
    }
  }
  return undefined
}

function isInsideType(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent) {
    if (TYPE_DECLARATION_TYPES.has(parent.type)) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function getEnclosingType(node: SyntaxNode): SyntaxNode | undefined {
  let parent = node.parent
  while (parent) {
    if (TYPE_DECLARATION_TYPES.has(parent.type)) {
      return parent
    }
    parent = parent.parent
  }
  return undefined
}

function getImmediateContainerType(node: SyntaxNode): string | undefined {
  let parent = node.parent
  while (parent) {
    if (TYPE_BODY_TYPES.has(parent.type)) {
      return parent.type
    }
    parent = parent.parent
  }
  return undefined
}

function isImplicitPublic(node: SyntaxNode): boolean {
  const container = getImmediateContainerType(node)
  if (container === "interface_body") {
    return node.type === "method_declaration" || node.type === "field_declaration"
  }
  if (container === "annotation_type_body") {
    return node.type === "method_declaration"
  }
  return false
}

function isImplicitAbstractMethod(node: SyntaxNode): boolean {
  if (node.type !== "method_declaration") return false
  if (hasModifier(node, "default") || hasModifier(node, "static") || hasModifier(node, "private")) {
    return false
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child?.type === "block") {
      return false
    }
  }
  const container = getImmediateContainerType(node)
  return container === "interface_body" || container === "annotation_type_body"
}

function extractAnnotationName(text: string): string | undefined {
  const match = text.match(/@([A-Za-z_][A-Za-z0-9_$.]*)/)
  return match ? `@${match[1]}` : undefined
}

function getAnnotations(node: SyntaxNode): string[] {
  const modifiers = getModifiersNode(node)
  if (!modifiers) return []

  const annotations: string[] = []
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i)
    if (!child) continue
    if (child.type === "marker_annotation" || child.type === "annotation") {
      const name = extractAnnotationName(child.text)
      if (name) annotations.push(name)
    }
  }
  return annotations
}

function sameNode(a: SyntaxNode | null, b: SyntaxNode | null): boolean {
  if (!a || !b) return false
  return (
    a.type === b.type &&
    a.startPosition.row === b.startPosition.row &&
    a.startPosition.column === b.startPosition.column &&
    a.endPosition.row === b.endPosition.row &&
    a.endPosition.column === b.endPosition.column
  )
}

function hasLeadingJavadoc(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return /\/\*\*/.test(node.text)

  let previous: SyntaxNode | null = null
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (!child) continue
    if (sameNode(child, node)) break
    previous = child
  }

  return previous?.type === "block_comment" && previous.text.trimStart().startsWith("/**")
}

function extractImportPath(node: SyntaxNode): string | undefined {
  const match = node.text.match(/^import\s+(?:static\s+)?(.+?);$/)
  return match?.[1]?.trim()
}

function extractFileImports(rootNode: SyntaxNode): string[] {
  const imports = new Set<string>()
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)
    if (child?.type === "import_declaration") {
      const importPath = extractImportPath(child)
      if (importPath) imports.add(importPath)
    }
  }
  return [...imports]
}

export const JavaLanguage: LanguageSupport = {
  id: "java",
  displayName: "Java",
  extensions: [".java"],
  parserWasm: "tree-sitter-java.wasm",
  reservedWords: JAVA_RESERVED_WORDS,

  variants: JAVA_VARIANTS,

  decorators: [
    "@Override",
    "@Deprecated",
    "@SuppressWarnings",
    "@Nullable",
    "@NotNull",
    "@Inject",
    "@Autowired",
    "@Transactional",
  ],

  isChunkBoundary(node: SyntaxNode): boolean {
    return CHUNK_BOUNDARY_TYPES.includes(node.type as any)
  },

  shouldSkipNode(node: SyntaxNode): boolean {
    return node.type === "import_declaration" || node.type === "package_declaration"
  },

  extractMetadata(node: SyntaxNode, _content: string, _filePath: string): ChunkMetadata {
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

    return {
      symbolName,
      symbolType: symbolType || "variable",
      variant,
      language: "java",
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
    if (node.type === "field_declaration") {
      return getFieldName(node)
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "identifier" || child?.type === "type_identifier") {
        return child.text
      }
    }

    return undefined
  },

  calculateComplexity(node: SyntaxNode): number {
    let score = 0

    const walk = (current: SyntaxNode) => {
      if (COMPLEXITY_NODE_TYPES.includes(current.type as any)) {
        score += current.type === "switch_expression" ? 2 : 1
      }
      if (current.type === "binary_expression") {
        const operator = current.child(1)?.text
        if (operator === "&&" || operator === "||") {
          score += 1
        }
      }

      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i)
        if (child) walk(child)
      }
    }

    walk(node)
    return score
  },

  isExported(node: SyntaxNode): boolean {
    return hasModifier(node, "public") || isImplicitPublic(node)
  },

  isAsync(_node: SyntaxNode): boolean {
    return false
  },

  isStatic(node: SyntaxNode): boolean {
    return hasModifier(node, "static")
  },

  isAbstract(node: SyntaxNode): boolean {
    return hasModifier(node, "abstract") || isImplicitAbstractMethod(node)
  },

  extractDecorators(node: SyntaxNode): string[] {
    return getAnnotations(node)
  },

  hasDocumentation(node: SyntaxNode): boolean {
    return hasLeadingJavadoc(node)
  },

  getParentScope(node: SyntaxNode): string | undefined {
    const parentType = getEnclosingType(node)
    if (!parentType) return undefined
    return this.extractNodeName(parentType)
  },

  getNodeTypes(symbolType: SemanticSymbolType, variant?: string): readonly string[] {
    switch (symbolType) {
      case "class":
        if (variant === "record") return ["record_declaration"]
        if (variant === "abstract") return ["class_declaration"]
        return ["class_declaration", "record_declaration"]

      case "method":
        if (variant === "static" || variant === "abstract") {
          return ["method_declaration"]
        }
        return ["method_declaration", "constructor_declaration"]

      case "type":
        if (variant === "interface") return ["interface_declaration"]
        if (variant === "annotation") return ["annotation_type_declaration"]
        return ["interface_declaration", "annotation_type_declaration"]

      case "variable":
        return ["field_declaration"]

      case "enum":
        return ["enum_declaration"]

      case "module":
        return ["package_declaration"]

      default:
        return []
    }
  },

  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined {
    switch (node.type) {
      case "class_declaration":
      case "record_declaration":
        return "class"
      case "method_declaration":
      case "constructor_declaration":
        return "method"
      case "interface_declaration":
      case "annotation_type_declaration":
        return "type"
      case "field_declaration":
        return "variable"
      case "enum_declaration":
        return "enum"
      case "package_declaration":
        return "module"
      default:
        return undefined
    }
  },

  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined {
    const symbolType = this.nodeToSymbolType(node)

    switch (symbolType) {
      case "class":
        if (node.type === "record_declaration") return "record"
        if (hasModifier(node, "abstract")) return "abstract"
        return undefined

      case "method":
        if (this.isStatic(node)) return "static"
        if (this.isAbstract(node)) return "abstract"
        return undefined

      case "type":
        if (node.type === "interface_declaration") return "interface"
        if (node.type === "annotation_type_declaration") return "annotation"
        return undefined

      case "variable":
        if (hasModifier(node, "final")) return "constant"
        return undefined

      default:
        return undefined
    }
  },
}

export async function chunk(content: string, filePath: string): Promise<Chunking.Chunk[]> {
  const parser = await javaParser()
  const tree = parser.parse(content)

  if (!tree || !tree.rootNode) {
    return []
  }

  const chunks: Chunking.Chunk[] = []
  const lines = content.split("\n")
  const rootNode = tree.rootNode as unknown as SyntaxNode
  const fileImports = extractFileImports(rootNode)
  const importsValue = fileImports.length > 0 ? fileImports.join(",") : undefined
  const boundaryNodes: SyntaxNode[] = []

  const walkContainer = (node: SyntaxNode) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (JavaLanguage.isChunkBoundary(child)) {
        boundaryNodes.push(child)
      }

      if (TYPE_DECLARATION_TYPES.has(child.type)) {
        const body = getTypeBody(child)
        if (body) {
          walkContainer(body)
        }
      }
    }
  }

  walkContainer(rootNode)

  for (const node of boundaryNodes) {
    const startLine = node.startPosition.row + 1
    const endLine = node.endPosition.row + 1
    const chunkContent = lines.slice(node.startPosition.row, node.endPosition.row + 1).join("\n")

    if (chunkContent.length < MIN_JAVA_CHUNK_SIZE) continue

    const metadata = JavaLanguage.extractMetadata(node, content, filePath)

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
      language: "java",
      imports: importsValue,
    })
  }

  return chunks
}
