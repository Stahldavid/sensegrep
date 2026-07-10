import { Log } from "../util/log.js"
import { TreeSitterChunking } from "./chunking-treesitter.js"
import { getLanguageForFile, chunkPython, chunkJava, chunkVue } from "./language/index.js"
import { getGeneralChunkLimits } from "./chunk-limits.js"
import { TreeShaker } from "./tree-shaker.js"

const log = Log.create({ service: "semantic.chunking" })

export namespace Chunking {
  function getChunkLimits() {
    return getGeneralChunkLimits()
  }

  function getLimits() {
    return getChunkLimits()
  }

  function getMaxChunkSize() {
    return getLimits().max
  }
  function getMinChunkSize() {
    return getLimits().min
  }

  type ChunkSegment = { content: string; startLine: number; endLine: number }

  function splitOversizedChunk(chunk: Chunk): Chunk[] {
    const maxChunkSize = getMaxChunkSize()
    const maxOverlapSize = getLimits().overlap
    if (chunk.content.length <= maxChunkSize) return [chunk]

    const segments: ChunkSegment[] = []
    const lines = chunk.content.split("\n")

    if (lines.length > 1) {
      let current: string[] = []
      let currentStartLine = chunk.startLine

      for (let offset = 0; offset < lines.length; offset++) {
        const line = lines[offset]
        const lineNumber = chunk.startLine + offset
        const candidate = current.length === 0 ? line : `${current.join("\n")}\n${line}`
        if (candidate.length <= maxChunkSize) {
          if (current.length === 0) currentStartLine = lineNumber
          current.push(line)
          continue
        }

        if (current.length > 0) {
          segments.push({
            content: current.join("\n"),
            startLine: currentStartLine,
            endLine: currentStartLine + current.length - 1,
          })
          current = []
        }

        if (line.length > maxChunkSize) {
          const step = Math.max(1, maxChunkSize - maxOverlapSize)
          for (let index = 0; index < line.length; index += step) {
            segments.push({
              content: line.slice(index, index + maxChunkSize),
              startLine: lineNumber,
              endLine: lineNumber,
            })
          }
        } else {
          current.push(line)
          currentStartLine = lineNumber
        }
      }

      if (current.length > 0) {
        segments.push({
          content: current.join("\n"),
          startLine: currentStartLine,
          endLine: currentStartLine + current.length - 1,
        })
      }
    } else {
      const step = Math.max(1, maxChunkSize - maxOverlapSize)
      for (let index = 0; index < chunk.content.length; index += step) {
        segments.push({
          content: chunk.content.slice(index, index + maxChunkSize),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        })
      }
    }

    return segments.filter((segment) => segment.content.length > 0).map((segment) => ({
      ...chunk,
      content: segment.content,
      startLine: segment.startLine,
      endLine: segment.endLine,
    }))
  }

  function enforceMaxChunkSize(chunks: Chunk[]): Chunk[] {
    const result: Chunk[] = []

    for (const chunk of chunks) {
      const segments = splitOversizedChunk(chunk)
      if (segments.length === 1) {
        result.push(segments[0])
        continue
      }

      result.push(...segments)
    }

    return result
  }

  export interface Chunk {
    content: string
    startLine: number
    endLine: number
    type: "code" | "text"

    // Semantic metadata for code chunks (collected from tree-sitter AST)
    symbolName?: string // Name of function/class/interface/type/namespace
    symbolType?: string // "function" | "class" | "interface" | "type" | "namespace" | "method" | "variable"
    variant?: string // Specific variant: "interface", "dataclass", "protocol", "async", etc.
    complexity?: number // Cyclomatic complexity (0-N)
    isExported?: boolean // Whether this is an exported symbol
    isAsync?: boolean // Whether this is an async function/method
    isStatic?: boolean // Whether this is a static method
    isAbstract?: boolean // Whether this is abstract
    decorators?: string[] // List of decorators (e.g., ["@property", "@staticmethod"])
    parentScope?: string // Parent context, e.g., "MyClass" for methods
    semanticKind?: string // Framework-aware kind, e.g. "convexMutation", "reactComponent"
    framework?: string // Framework/library inferred from code shape, e.g. "convex", "react"
    scopeDepth?: number // Nesting level
    hasDocumentation?: boolean // Whether JSDoc/comments are present
    language?: string // "typescript" | "javascript" | "python" etc
    imports?: string // Comma-separated imported module names for filtering
    calls?: string // Comma-separated call targets extracted from the AST
  }

  export type Analysis = {
    chunks: Chunk[]
    collapsibleRegions: TreeShaker.CollapsibleRegion[]
  }

  /**
   * Detect if file is code based on extension
   */
  function isCodeFile(filePath: string): boolean {
    if (getLanguageForFile(filePath)) return true
    const codeExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".rb",
      ".php",
      ".swift",
      ".kt",
      ".scala",
      ".vue",
      ".svelte",
    ]
    return codeExtensions.some((ext) => filePath.endsWith(ext))
  }

  /**
   * Chunk code files by logical boundaries (functions, classes)
   * Tries tree-sitter AST-based chunking first, falls back to regex
   */
  async function chunkCodeAsync(content: string, filePath: string): Promise<Chunk[]> {
    const language = getLanguageForFile(filePath)

    if (language?.chunk) {
      try {
        const chunks = await language.chunk(content, filePath)
        if (chunks.length > 0) {
          log.info("used registered language chunker", { language: language.id, filePath, chunks: chunks.length })
          return chunks
        }
      } catch (error) {
        log.warn("registered language chunker failed, falling back", {
          language: language.id,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (language?.id === "python") {
      try {
        const chunks = await chunkPython(content, filePath)
        if (chunks.length > 0) {
          log.info("used tree-sitter chunking (Python)", { filePath, chunks: chunks.length })
          return chunks
        }
        log.warn("Python chunking returned 0 chunks, falling back to regex", { filePath })
      } catch (error) {
        log.warn("Python chunking failed, falling back to regex", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (language?.id === "java") {
      try {
        const chunks = await chunkJava(content, filePath)
        if (chunks.length > 0) {
          log.info("used tree-sitter chunking (Java)", { filePath, chunks: chunks.length })
          return chunks
        }
        log.warn("Java chunking returned 0 chunks, falling back to regex", { filePath })
      } catch (error) {
        log.warn("Java chunking failed, falling back to regex", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (language?.id === "vue") {
      try {
        const chunks = await chunkVue(content, filePath)
        if (chunks.length > 0) {
          log.info("used tree-sitter chunking (Vue)", { filePath, chunks: chunks.length })
          return chunks
        }
        log.warn("Vue chunking returned 0 chunks, falling back to regex", { filePath })
      } catch (error) {
        log.warn("Vue chunking failed, falling back to regex", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Try tree-sitter for TypeScript/JavaScript
    if (TreeSitterChunking.isSupported(filePath)) {
      try {
        const chunks = await TreeSitterChunking.chunk(content, filePath)
        if (chunks.length > 0) {
          log.info("used tree-sitter chunking (TypeScript/JavaScript)", { filePath, chunks: chunks.length })
          return chunks
        }
        log.warn("tree-sitter returned 0 chunks, falling back to regex", { filePath })
      } catch (error) {
        log.warn("tree-sitter chunking failed, falling back to regex", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
        // Fall through to regex chunking
      }
    }

    // Fallback: regex-based chunking
    return chunkCodeRegex(content, filePath)
  }

  /**
   * Original regex-based code chunking (fallback)
   */
  function chunkCodeRegex(content: string, filePath: string): Chunk[] {
    const lines = content.split("\n")
    const chunks: Chunk[] = []

    // Patterns that indicate logical boundaries
    const boundaryPatterns = [
      /^(export\s+)?(async\s+)?function\s+\w+/, // function declarations
      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/, // arrow functions
      /^(export\s+)?class\s+\w+/, // class declarations
      /^(export\s+)?interface\s+\w+/, // interface declarations
      /^(export\s+)?type\s+\w+/, // type declarations
      /^(export\s+)?enum\s+\w+/, // enum declarations
      /^(export\s+)?namespace\s+\w+/, // namespace declarations
      /^def\s+\w+/, // Python functions
      /^class\s+\w+/, // Python classes
      /^func\s+\w+/, // Go functions
      /^fn\s+\w+/, // Rust functions
      /^impl\s+/, // Rust impl blocks
    ]

    let currentChunk: string[] = []
    let chunkStartLine = 0
    let braceDepth = 0
    let inBlock = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // Track brace depth
      braceDepth += (line.match(/{/g) || []).length
      braceDepth -= (line.match(/}/g) || []).length

      // Check if this is a boundary
      const isBoundary = boundaryPatterns.some((p) => p.test(trimmedLine))

      if (isBoundary && currentChunk.length > 0 && !inBlock) {
        // Save current chunk
        const chunkContent = currentChunk.join("\n")
        if (chunkContent.length >= getMinChunkSize()) {
          chunks.push({
            content: chunkContent,
            startLine: chunkStartLine + 1,
            endLine: i,
            type: "code",
          })
        }
        currentChunk = []
        chunkStartLine = i
      }

      currentChunk.push(line)
      inBlock = braceDepth > 0

      // Force split if chunk gets too large (including minified/vendor files)
      const currentContent = currentChunk.join("\n")
      if (currentContent.length > getMaxChunkSize()) {
        chunks.push({
          content: currentContent,
          startLine: chunkStartLine + 1,
          endLine: i + 1,
          type: "code",
        })
        currentChunk = []
        chunkStartLine = i + 1
        inBlock = braceDepth > 0
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join("\n")
      if (chunkContent.length >= getMinChunkSize()) {
        chunks.push({
          content: chunkContent,
          startLine: chunkStartLine + 1,
          endLine: lines.length,
          type: "code",
        })
      }
    }

    const normalizedChunks = enforceMaxChunkSize(chunks)
    log.info("chunked code file", { filePath, chunks: normalizedChunks.length })
    return normalizedChunks
  }

  /**
   * Chunk text/markdown files by paragraphs
   */
  function chunkText(content: string, filePath: string): Chunk[] {
    const lines = content.split("\n")
    const chunks: Chunk[] = []

    let currentChunk: string[] = []
    let chunkStartLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isBlankLine = line.trim() === ""
      const isHeading = /^#{1,6}\s/.test(line)

      // Start new chunk on heading or after blank line when chunk is big enough
      const currentContent = currentChunk.join("\n")
      const shouldSplit =
        (isHeading && currentChunk.length > 0) || (isBlankLine && currentContent.length > getMaxChunkSize() / 2)

      if (shouldSplit && currentContent.length >= getMinChunkSize()) {
        chunks.push({
          content: currentContent,
          startLine: chunkStartLine + 1,
          endLine: i,
          type: "text",
        })
        currentChunk = []
        chunkStartLine = i
      }

      if (!isBlankLine || currentChunk.length > 0) {
        currentChunk.push(line)
      }

      // Force split if too large
      if (currentChunk.join("\n").length > getMaxChunkSize()) {
        chunks.push({
          content: currentChunk.join("\n"),
          startLine: chunkStartLine + 1,
          endLine: i + 1,
          type: "text",
        })
        currentChunk = []
        chunkStartLine = i + 1
      }
    }

    // Last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join("\n")
      if (chunkContent.length >= getMinChunkSize()) {
        chunks.push({
          content: chunkContent,
          startLine: chunkStartLine + 1,
          endLine: lines.length,
          type: "text",
        })
      }
    }

    const normalizedChunks = enforceMaxChunkSize(chunks)
    log.info("chunked text file", { filePath, chunks: normalizedChunks.length })
    return normalizedChunks
  }

  /**
   * Chunk a file into semantic pieces (synchronous wrapper)
   */
  export function chunk(content: string, filePath: string): Chunk[] {
    if (content.length < getMinChunkSize()) {
      return [
        {
          content,
          startLine: 1,
          endLine: content.split("\n").length,
          type: isCodeFile(filePath) ? "code" : "text",
        },
      ]
    }

    if (isCodeFile(filePath)) {
      // Use synchronous regex chunking for now
      // (async tree-sitter available via chunkAsync)
      return chunkCodeRegex(content, filePath)
    }
    return chunkText(content, filePath)
  }

  /**
   * Async version that uses tree-sitter when possible
   */
  export async function chunkAsync(content: string, filePath: string): Promise<Chunk[]> {
    if (content.length < getMinChunkSize()) {
      return [
        {
          content,
          startLine: 1,
          endLine: content.split("\n").length,
          type: isCodeFile(filePath) ? "code" : "text",
        },
      ]
    }

    if (isCodeFile(filePath)) {
      return enforceMaxChunkSize(await chunkCodeAsync(content, filePath))
    }
    return enforceMaxChunkSize(chunkText(content, filePath))
  }

  export async function analyzeAsync(content: string, filePath: string): Promise<Analysis> {
    if (TreeSitterChunking.isSupported(filePath)) {
      try {
        const parsed = await TreeSitterChunking.analyze(content, filePath)
        const chunks = content.length < getMinChunkSize()
          ? [{
              content,
              startLine: 1,
              endLine: parsed.lines.length,
              type: "code" as const,
            }]
          : enforceMaxChunkSize(
              parsed.chunks.length > 0 ? parsed.chunks : chunkCodeRegex(content, filePath),
            )
        const collapsibleRegions = parsed.tree
          ? TreeShaker.findCollapsibleRegions(parsed.tree, parsed.lines)
          : []
        return { chunks, collapsibleRegions }
      } catch (error) {
        log.warn("shared tree-sitter analysis failed, using independent fallbacks", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const [chunks, collapsibleRegions] = await Promise.all([
      chunkAsync(content, filePath),
      TreeShaker.extractRegions(filePath, content),
    ])
    return { chunks, collapsibleRegions }
  }

  /**
   * Create overlapping chunks for better context
   */
  export function addOverlap(chunks: Chunk[]): Chunk[] {
    if (chunks.length <= 1) return chunks

    const result: Chunk[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      let content = chunk.content

      // Add context from previous chunk
      if (i > 0) {
        const prevContent = chunks[i - 1].content
        const limits = getLimits()
        const chunkTokens = Math.ceil(content.length / limits.charsPerToken)
        const availableChars = Math.max(0, limits.max - content.length - 5)
        const adaptiveOverlapChars = Math.min(
          limits.overlap,
          availableChars,
          Math.max(0, Math.floor(chunkTokens * 0.15) * limits.charsPerToken),
        )
        const overlap = adaptiveOverlapChars > 0 ? prevContent.slice(-adaptiveOverlapChars) : ""
        if (overlap) {
          content = `...${overlap}\n\n${content}`
        }
      }

      result.push({
        ...chunk,
        content,
      })
    }

    return result
  }
}
