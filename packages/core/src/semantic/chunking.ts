import { Log } from "../util/log.js"
import { TreeSitterChunking } from "./chunking-treesitter.js"
import { getEmbeddingConfig } from "./embedding-config.js"

const log = Log.create({ service: "semantic.chunking" })

export namespace Chunking {
  // Chunk size limits vary by embedding model
  // Local (BAAI/bge-small-en-v1.5): 512 tokens → conservative chunk sizes
  // Gemini (gemini-embedding-001): 2048 tokens → aggressive chunk sizes
  const CHUNK_LIMITS = {
    local: {
      max: 1200, // ~300 tokens (safe for 512 token limit)
      min: 100,
      overlap: 150,
    },
    gemini: {
      max: 7500, // ~1875 tokens (safe for 2048 token limit with margin)
      min: 200,
      overlap: 500,
    },
  } as const

  // Get chunk limits based on current embedding provider
  function getChunkLimits() {
    try {
      const config = getEmbeddingConfig()
      const provider = config.provider === "gemini" ? "gemini" : "local"
      log.info("chunk limits provider detected", {
        provider,
        max: CHUNK_LIMITS[provider].max,
        envProvider: process.env.SENSEGREP_PROVIDER
      })
      return CHUNK_LIMITS[provider]
    } catch (error) {
      // Fallback to local limits if can't detect
      log.warn("failed to detect provider, using local limits", { error: String(error) })
      return CHUNK_LIMITS.local
    }
  }

  // Dynamic chunk sizes based on provider (lazy evaluation)
  let cachedLimits: typeof CHUNK_LIMITS.local | typeof CHUNK_LIMITS.gemini | null = null
  function getLimits() {
    if (!cachedLimits) {
      cachedLimits = getChunkLimits()
    }
    return cachedLimits
  }

  function getMaxChunkSize() { return getLimits().max }
  function getMinChunkSize() { return getLimits().min }
  function getOverlapSize() { return getLimits().overlap }

  const MAX_CHUNK_SIZE = getMaxChunkSize()
  const MIN_CHUNK_SIZE = getMinChunkSize()
  const OVERLAP_SIZE = getOverlapSize()

  export interface Chunk {
    content: string
    startLine: number
    endLine: number
    type: "code" | "text"

    // Semantic metadata for code chunks (collected from tree-sitter AST)
    symbolName?: string // Name of function/class/interface/type/namespace
    symbolType?: string // "function" | "class" | "interface" | "type" | "namespace" | "method" | "variable"
    complexity?: number // Cyclomatic complexity (0-N)
    isExported?: boolean // Whether this is an exported symbol
    parentScope?: string // Parent context, e.g., "MyClass" for methods
    scopeDepth?: number // Nesting level
    hasDocumentation?: boolean // Whether JSDoc/comments are present
    language?: string // "typescript" | "javascript" | "python" etc
    imports?: string // Comma-separated imported module names for filtering
  }

  /**
   * Detect if file is code based on extension
   */
  function isCodeFile(filePath: string): boolean {
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
    // Try tree-sitter for supported languages
    if (TreeSitterChunking.isSupported(filePath)) {
      try {
        const chunks = await TreeSitterChunking.chunk(content, filePath)
        if (chunks.length > 0) {
          log.info("used tree-sitter chunking", { filePath, chunks: chunks.length })
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
        if (chunkContent.length >= MIN_CHUNK_SIZE) {
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

      // Force split if chunk gets too large
      const currentContent = currentChunk.join("\n")
      if (currentContent.length > MAX_CHUNK_SIZE && braceDepth === 0) {
        chunks.push({
          content: currentContent,
          startLine: chunkStartLine + 1,
          endLine: i + 1,
          type: "code",
        })
        currentChunk = []
        chunkStartLine = i + 1
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join("\n")
      if (chunkContent.length >= MIN_CHUNK_SIZE) {
        chunks.push({
          content: chunkContent,
          startLine: chunkStartLine + 1,
          endLine: lines.length,
          type: "code",
        })
      }
    }

    log.info("chunked code file", { filePath, chunks: chunks.length })
    return chunks
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
        (isHeading && currentChunk.length > 0) || (isBlankLine && currentContent.length > MAX_CHUNK_SIZE / 2)

      if (shouldSplit && currentContent.length >= MIN_CHUNK_SIZE) {
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
      if (currentChunk.join("\n").length > MAX_CHUNK_SIZE) {
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
      if (chunkContent.length >= MIN_CHUNK_SIZE) {
        chunks.push({
          content: chunkContent,
          startLine: chunkStartLine + 1,
          endLine: lines.length,
          type: "text",
        })
      }
    }

    log.info("chunked text file", { filePath, chunks: chunks.length })
    return chunks
  }

  /**
   * Chunk a file into semantic pieces (synchronous wrapper)
   */
  export function chunk(content: string, filePath: string): Chunk[] {
    if (content.length < MIN_CHUNK_SIZE) {
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
    if (content.length < MIN_CHUNK_SIZE) {
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
      return await chunkCodeAsync(content, filePath)
    }
    return chunkText(content, filePath)
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
        const overlap = prevContent.slice(-OVERLAP_SIZE)
        content = `...${overlap}\n\n${content}`
      }

      result.push({
        ...chunk,
        content,
      })
    }

    return result
  }
}
