/**
 * Vue Single-File Component Language Support
 *
 * Uses tree-sitter-vue to locate SFC blocks and tree-sitter TypeScript/TSX
 * to analyze the contents of <script> and <script setup>.
 */

import path from "node:path"
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
import { tsParser, tsxParser, TypeScriptLanguage, JavaScriptLanguage } from "./typescript.js"

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

export const vueParser = lazy(() => initParser("tree-sitter-vue.wasm"))

const VUE_RESERVED_WORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "await",
  "async",
  "defineProps",
  "defineEmits",
  "defineExpose",
  "defineSlots",
  "defineModel",
  "computed",
  "ref",
  "reactive",
])

const VUE_VARIANTS: readonly LanguageVariantDef[] = [
  { name: "component", description: "Vue single-file component", category: "type" },
  { name: "setup", description: "<script setup> block", category: "modifier" },
  { name: "interface", description: "Interface declaration inside SFC script", category: "type" },
  { name: "alias", description: "Type alias inside SFC script", category: "type" },
  { name: "enum", description: "Enum declaration inside SFC script", category: "type" },
  { name: "async", description: "Async function/method", category: "modifier" },
  { name: "static", description: "Static method", category: "modifier" },
  { name: "abstract", description: "Abstract class/method", category: "modifier" },
  { name: "arrow", description: "Arrow function", category: "modifier" },
  { name: "generator", description: "Generator function", category: "modifier" },
] as const

const MIN_VUE_CHUNK_SIZE = 20

export interface VueScriptBlock {
  content: string
  lang: "ts" | "tsx" | "js"
  isSetup: boolean
  rawTextStartRow: number
  startLine: number
  endLine: number
}

function getAttributeMap(startTag: SyntaxNode): Map<string, string | true> {
  const attrs = new Map<string, string | true>()
  for (let i = 0; i < startTag.childCount; i++) {
    const child = startTag.child(i)
    if (child?.type !== "attribute") continue

    let name = ""
    let value: string | true = true
    for (let j = 0; j < child.childCount; j++) {
      const attrChild = child.child(j)
      if (!attrChild) continue
      if (attrChild.type === "attribute_name") {
        name = attrChild.text
      } else if (attrChild.type === "quoted_attribute_value") {
        value = attrChild.text.replace(/^['"]|['"]$/g, "")
      }
    }
    if (name) attrs.set(name, value)
  }
  return attrs
}

function normalizeVueScriptLang(attrs: Map<string, string | true>): VueScriptBlock["lang"] {
  const lang = attrs.get("lang")
  if (lang === "tsx" || lang === "jsx") return "tsx"
  if (lang === "js" || lang === "javascript") return "js"
  return "ts"
}

function parseImportsFromScript(content: string): string | undefined {
  const imports = new Set<string>()
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    const fromMatch = trimmed.match(/^import\s+.+?\s+from\s+["']([^"']+)["']/)
    if (fromMatch?.[1]) {
      imports.add(fromMatch[1])
      continue
    }
    const sideEffectMatch = trimmed.match(/^import\s+["']([^"']+)["']/)
    if (sideEffectMatch?.[1]) {
      imports.add(sideEffectMatch[1])
    }
  }
  return imports.size > 0 ? [...imports].join(",") : undefined
}

function buildComponentChunk(
  filePath: string,
  content: string,
  imports?: string,
): Chunking.Chunk {
  return {
    content,
    startLine: 1,
    endLine: content.split("\n").length,
    type: "code",
    symbolName: path.basename(filePath, path.extname(filePath)),
    symbolType: "module",
    variant: "component",
    complexity: 0,
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    hasDocumentation: /<script[^>]*>[\s\S]*?\/\*\*/.test(content),
    language: "vue",
    imports,
  }
}

export async function extractVueScriptBlocks(content: string): Promise<VueScriptBlock[]> {
  const parser = await vueParser()
  const tree = parser.parse(content)
  if (!tree?.rootNode) return []

  const blocks: VueScriptBlock[] = []

  for (let i = 0; i < tree.rootNode.childCount; i++) {
    const node = tree.rootNode.child(i)
    if (node?.type !== "script_element") continue

    let startTag: SyntaxNode | null = null
    let rawText: SyntaxNode | null = null
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j)
      if (!child) continue
      if (child.type === "start_tag") startTag = child
      if (child.type === "raw_text") rawText = child
    }

    if (!startTag || !rawText) continue

    const attrs = getAttributeMap(startTag)
    blocks.push({
      content: rawText.text,
      lang: normalizeVueScriptLang(attrs),
      isSetup: attrs.has("setup"),
      rawTextStartRow: rawText.startPosition.row,
      startLine: rawText.startPosition.row + 1,
      endLine: rawText.endPosition.row + 1,
    })
  }

  return blocks
}

async function getInnerScriptParser(block: VueScriptBlock) {
  if (block.lang === "tsx") return tsxParser()
  return tsParser()
}

function getInnerLanguageSupport(block: VueScriptBlock) {
  return block.lang === "js" ? JavaScriptLanguage : TypeScriptLanguage
}

function getInnerFilePath(filePath: string, block: VueScriptBlock): string {
  if (block.lang === "tsx") return `${filePath}.tsx`
  if (block.lang === "js") return `${filePath}.js`
  return `${filePath}.ts`
}

export const VueLanguage: LanguageSupport = {
  id: "vue",
  displayName: "Vue",
  extensions: [".vue"],
  parserWasm: "tree-sitter-vue.wasm",
  reservedWords: VUE_RESERVED_WORDS,

  variants: VUE_VARIANTS,

  decorators: [],

  isChunkBoundary(node: SyntaxNode): boolean {
    return node.type === "script_element" || node.type === "template_element"
  },

  shouldSkipNode(node: SyntaxNode): boolean {
    return node.type === "style_element"
  },

  extractMetadata(_node: SyntaxNode, _content: string, filePath: string): ChunkMetadata {
    return {
      symbolName: path.basename(filePath, path.extname(filePath)),
      symbolType: "module",
      variant: "component",
      language: "vue",
      isExported: true,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: [],
      complexity: 0,
      hasDocumentation: false,
    }
  },

  extractNodeName(_node: SyntaxNode): string | undefined {
    return undefined
  },

  calculateComplexity(_node: SyntaxNode): number {
    return 0
  },

  isExported(_node: SyntaxNode): boolean {
    return true
  },

  isAsync(_node: SyntaxNode): boolean {
    return false
  },

  isStatic(_node: SyntaxNode): boolean {
    return false
  },

  isAbstract(_node: SyntaxNode): boolean {
    return false
  },

  extractDecorators(_node: SyntaxNode): string[] {
    return []
  },

  hasDocumentation(_node: SyntaxNode): boolean {
    return false
  },

  getParentScope(_node: SyntaxNode): string | undefined {
    return undefined
  },

  getNodeTypes(symbolType: SemanticSymbolType, variant?: string): readonly string[] {
    switch (symbolType) {
      case "module":
        return ["component"]
      case "function":
      case "method":
      case "class":
      case "type":
      case "variable":
      case "enum":
        return variant ? [variant] : []
      default:
        return []
    }
  },

  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined {
    if (node.type === "script_element" || node.type === "template_element") {
      return "module"
    }
    return undefined
  },

  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined {
    if (node.type === "script_element" || node.type === "template_element") {
      return "component"
    }
    return undefined
  },
}

export async function chunk(content: string, filePath: string): Promise<Chunking.Chunk[]> {
  const scriptBlocks = await extractVueScriptBlocks(content)
  const chunks: Chunking.Chunk[] = []
  const allImports = new Set<string>()

  for (const block of scriptBlocks) {
    const parser = await getInnerScriptParser(block)
    const tree = parser.parse(block.content)
    if (!tree?.rootNode) continue

    const languageSupport = getInnerLanguageSupport(block)
    const innerFilePath = getInnerFilePath(filePath, block)
    const imports = parseImportsFromScript(block.content)
    if (imports) {
      for (const entry of imports.split(",")) {
        if (entry) allImports.add(entry)
      }
    }

    const visit = (node: SyntaxNode) => {
      if (languageSupport.isChunkBoundary(node)) {
        const chunkContent = block.content
          .split("\n")
          .slice(node.startPosition.row, node.endPosition.row + 1)
          .join("\n")

        if (chunkContent.length >= MIN_VUE_CHUNK_SIZE) {
          const metadata = languageSupport.extractMetadata(node, block.content, innerFilePath)
          chunks.push({
            content: chunkContent,
            startLine: block.rawTextStartRow + node.startPosition.row + 1,
            endLine: block.rawTextStartRow + node.endPosition.row + 1,
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
            language: "vue",
            imports,
          })
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) visit(child)
      }
    }

    visit(tree.rootNode as unknown as SyntaxNode)
  }

  const componentImports = allImports.size > 0 ? [...allImports].join(",") : undefined
  if (chunks.length > 0) {
    chunks.unshift(buildComponentChunk(filePath, content, componentImports))
    return chunks
  }

  return scriptBlocks.length > 0 || content.trim().length >= MIN_VUE_CHUNK_SIZE
    ? [buildComponentChunk(filePath, content, componentImports)]
    : []
}
