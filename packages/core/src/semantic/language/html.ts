/**
 * HTML Language Support
 *
 * Implements LanguageSupport interface for HTML files.
 * Handles .html, .htm extensions.
 *
 * Mappings:
 * - Symbol Type: Mapped from tag category (e.g., <script> -> function, <div> -> class)
 * - Variant: The tag name itself (e.g., "div", "section", "button")
 * - Decorators: CSS classes (e.g., ".btn", ".container")
 * - Symbol Name: ID attribute > Name attribute > First CSS class
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

const initParser = async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const treePath = resolveWasmPath("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const langPath = resolveWasmPath("tree-sitter-wasms/out/tree-sitter-html.wasm")
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const language = await Language.load(langPath)
  const p = new Parser()
  p.setLanguage(language)
  return p
}

/** Lazy-loaded HTML parser */
export const htmlParser = lazy(() => initParser())

// ============================================================================ 
// Constants & Mappings
// ============================================================================ 

const HTML_RESERVED_WORDS = new Set([
  "html", "head", "body", "div", "span", "a", "img", "table", "tr", "td",
  "th", "ul", "ol", "li", "form", "input", "button", "script", "style",
  "link", "meta", "title", "h1", "h2", "h3", "h4", "h5", "h6", "p",
  "section", "article", "aside", "nav", "header", "footer", "main",
])

// Structural tags are treated as "classes" (containers)
const STRUCTURAL_TAGS = new Set([
  "div", "section", "article", "aside", "nav", "header", "footer", "main",
  "form", "table", "ul", "ol", "body", "head", "html",
])

// Interactive/Action tags are treated as "functions"
const INTERACTIVE_TAGS = new Set([
  "button", "a", "input", "select", "textarea", "details", "summary",
  "script", // Code execution
])

// Metadata/Data tags are treated as "variables" or "modules"
const DATA_TAGS = new Set([
  "meta", "link", "title", "style", "img", "video", "audio", "source",
])

// Tags that define chunk boundaries
const CHUNK_BOUNDARY_TAGS = new Set([
  ...STRUCTURAL_TAGS,
  "script",
  "style",
])

// ============================================================================ 
// Helper Functions
// ============================================================================ 

function getTagName(node: SyntaxNode): string | undefined {
  if (node.type !== "element" && node.type !== "script_element" && node.type !== "style_element") {
    return undefined
  }
  
  // For script and style elements, they might not have a start_tag in the same way
  if (node.type === "script_element") return "script";
  if (node.type === "style_element") return "style";

  // First child of start_tag is the tag name
  // element -> start_tag -> tag_name
  const startTag = node.childForFieldName("start_tag")
  if (startTag) {
    const tagNameNode = startTag.childForFieldName("name")
    if (tagNameNode) return tagNameNode.text.toLowerCase()
  }

  // Fallback: search children for a start_tag
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === "start_tag") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) return nameNode.text.toLowerCase();
      // Try first child of start_tag if field name fails
      const firstNameNode = child.child(1); // Usually < is 0, name is 1
      if (firstNameNode) return firstNameNode.text.toLowerCase();
    }
  }
  
  return undefined
}

function getAttribute(node: SyntaxNode, attrName: string): string | undefined {
  let startTag = node.childForFieldName("start_tag")
  
  if (!startTag) {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === "start_tag") {
        startTag = node.child(i);
        break;
      }
    }
  }

  if (!startTag) return undefined

  // Iterate over attributes
  for (let i = 0; i < startTag.childCount; i++) {
    const child = startTag.child(i)
    if (child?.type === "attribute") {
      const nameNode = child.childForFieldName("name") || child.child(0)
      if (nameNode?.text === attrName) {
        let valueNode = child.childForFieldName("value")
        if (!valueNode) {
          // Look for quoted_attribute_value or attribute_value
          for (let j = 0; j < child.childCount; j++) {
            const c = child.child(j);
            if (c?.type === "quoted_attribute_value" || c?.type === "attribute_value") {
              valueNode = c;
              break;
            }
          }
        }
        
        if (valueNode) {
          return valueNode.text.replace(/^["']|["']$/g, "")
        }
        return ""
      }
    }
  }
  return undefined
}

function getClasses(node: SyntaxNode): string[] {
  const classStr = getAttribute(node, "class")
  if (!classStr) return []
  return classStr.split(/\s+/).filter(Boolean)
}

function calculateDepth(node: SyntaxNode): number {
  let depth = 0
  let parent = node.parent
  while (parent) {
    if (parent.type === "element") {
      depth++
    }
    parent = parent.parent
  }
  return depth
}

// ============================================================================ 
// HTML Language Support Implementation
// ============================================================================ 

export const HtmlLanguage: LanguageSupport = {
  id: "html",
  displayName: "HTML",
  extensions: [".html", ".htm"],
  parserWasm: "tree-sitter-html.wasm",
  reservedWords: HTML_RESERVED_WORDS,

  variants: [
    // Standard variants will be dynamically populated from tag names found,
    // but we define common categories here for help text
    { name: "div", description: "Generic container", category: "type" },
    { name: "section", description: "Semantic section", category: "type" },
    { name: "form", description: "Input form", category: "type" },
    { name: "script", description: "Script block", category: "modifier" },
    { name: "style", description: "Style block", category: "modifier" },
  ],

  decorators: [], // Will be populated dynamically with CSS classes (e.g. .btn)

  isChunkBoundary(node: SyntaxNode): boolean {
    if (node.type === "element" || node.type === "script_element" || node.type === "style_element") {
      const tagName = getTagName(node)
      return !!tagName && CHUNK_BOUNDARY_TAGS.has(tagName)
    }
    return false
  },

  shouldSkipNode(node: SyntaxNode): boolean {
    return node.type === "doctype" || node.type === "comment"
  },

  extractMetadata(node: SyntaxNode, _content: string, _filePath: string): ChunkMetadata {
    const tagName = getTagName(node) || "unknown"
    const id = getAttribute(node, "id")
    const nameAttr = getAttribute(node, "name")
    const classes = getClasses(node)
    
    // Symbol Name: ID > Name > First Class > Tag Name
    let symbolName = id
    if (!symbolName) symbolName = nameAttr
    if (!symbolName && classes.length > 0) symbolName = classes[0]
    
    // Symbol Type Mapping
    let symbolType: SemanticSymbolType = "variable"
    if (STRUCTURAL_TAGS.has(tagName)) symbolType = "class"
    else if (INTERACTIVE_TAGS.has(tagName)) symbolType = "function"
    else if (DATA_TAGS.has(tagName)) symbolType = "module" // or variable
    
    // Variant is the tag name itself
    const variant = tagName

    // Decorators are CSS classes (prefixed with .)
    const decorators = classes.map(c => `.${c}`)

    // Complexity based on nesting
    const complexity = calculateDepth(node)

    // Exported? HTML is declarative, everything is "public"
    const isExported = true
    
    // Async? Only scripts with async attr
    const isAsync = tagName === "script" && getAttribute(node, "async") !== undefined

    return {
      symbolName,
      symbolType,
      variant,
      language: "html",
      isExported,
      isAsync,
      isStatic: false,
      isAbstract: false,
      decorators,
      complexity,
      hasDocumentation: false, // HTML doesn't have JSDoc equivalent widely used
      parentScope: undefined, // Could trace up to parent ID
    }
  },

  extractNodeName(node: SyntaxNode): string | undefined {
    return getAttribute(node, "id") || getAttribute(node, "name")
  },

  calculateComplexity(node: SyntaxNode): number {
    return calculateDepth(node)
  },

  isExported(_node: SyntaxNode): boolean {
    return true
  },

  isAsync(node: SyntaxNode): boolean {
    return getTagName(node) === "script" && getAttribute(node, "async") !== undefined
  },

  isStatic(_node: SyntaxNode): boolean {
    return false
  },

  isAbstract(_node: SyntaxNode): boolean {
    return false
  },

  extractDecorators(node: SyntaxNode): string[] {
    return getClasses(node).map(c => `.${c}`)
  },

  hasDocumentation(_node: SyntaxNode): boolean {
    return false
  },

  getParentScope(node: SyntaxNode): string | undefined {
    let parent = node.parent
    while (parent) {
      if (this.isChunkBoundary(parent)) {
        const id = getAttribute(parent, "id")
        if (id) return id
        const tagName = getTagName(parent)
        if (tagName) return tagName
      }
      parent = parent.parent
    }
    return undefined
  },

  getNodeTypes(symbolType: SemanticSymbolType, _variant?: string): readonly string[] {
    // Map back for filtering (approximate)
    switch (symbolType) {
      case "class":
        return ["element"] // Structural tags
      case "function":
        return ["element", "script_element"] // Interactive + Scripts
      case "module":
        return ["style_element", "script_element"]
      default:
        return ["element"]
    }
  },

  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined {
    const tagName = getTagName(node)
    if (!tagName) return undefined
    
    if (STRUCTURAL_TAGS.has(tagName)) return "class"
    if (INTERACTIVE_TAGS.has(tagName)) return "function"
    if (DATA_TAGS.has(tagName)) return "module"
    
    return "variable"
  },

  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined {
    return getTagName(node)
  },
}

// ============================================================================ 
// HTML Chunking Function
// ============================================================================ 

export async function chunk(content: string, filePath: string): Promise<Chunking.Chunk[]> {
  const parser = await htmlParser()
  const tree = parser.parse(content)
  
  if (!tree || !tree.rootNode) {
    return []
  }

  const chunks: Chunking.Chunk[] = []
  const lines = content.split("\n")

  const collectChunks = (node: SyntaxNode) => {
    // Skip small text nodes or comments
    if (HtmlLanguage.shouldSkipNode(node)) return

    if (HtmlLanguage.isChunkBoundary(node)) {
      const startLine = node.startPosition.row + 1
      const endLine = node.endPosition.row + 1
      
      // Get content
      const chunkLines = lines.slice(node.startPosition.row, node.endPosition.row + 1)
      const chunkContent = chunkLines.join("\n")

      // Only chunk if it has significant content (>50 chars) or is a script/style
      const isScriptOrStyle = node.type === "script_element" || node.type === "style_element"
      if (chunkContent.length > 50 || isScriptOrStyle) {
        const metadata = HtmlLanguage.extractMetadata(node, content, filePath)
        
        chunks.push({
          content: chunkContent,
          startLine,
          endLine,
          type: "code", // Treat structure as code for semantic analysis
          ...metadata,
        })
        
        // Don't recurse if we just chunked a script or style block (treat as atomic)
        if (isScriptOrStyle) return
      }
    }

    // Recurse to find nested chunks (e.g. form inside div)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) collectChunks(child)
    }
  }

  collectChunks(tree.rootNode)
  return chunks
}
