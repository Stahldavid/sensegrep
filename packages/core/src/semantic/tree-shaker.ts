/**
 * Semantic Tree-Shaker
 *
 * Renders search results with intelligent collapsing:
 * - Keeps: imports, class signatures, properties, relevant methods
 * - Collapses: irrelevant methods/functions (shows signature + "hidden" comment)
 *
 * This provides maximum context with minimum tokens for AI agents.
 */

import { Log } from "../util/log.js"
import { lazy } from "../util/lazy.js"
import type { Tree } from "web-tree-sitter"
import { createRequire } from "module"
import { readFile } from "node:fs/promises"
import path from "path"
import { getLanguageForFile } from "./language/index.js"

const log = Log.create({ service: "semantic.tree-shaker" })

// SyntaxNode type from web-tree-sitter
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
  gotoParent: () => boolean
}

const require = createRequire(import.meta.url)
const resolveWasmPath = (id: string) => require.resolve(id)

// Lazy-loaded TypeScript parser
const tsParser = lazy(async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const treePath = resolveWasmPath("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const tsPath = resolveWasmPath("tree-sitter-wasms/out/tree-sitter-typescript.wasm")
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const tsLanguage = await Language.load(tsPath)
  const p = new Parser()
  p.setLanguage(tsLanguage)
  return p
})

// Lazy-loaded TSX parser
const tsxParser = lazy(async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const treePath = resolveWasmPath("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const tsxPath = resolveWasmPath("tree-sitter-wasms/out/tree-sitter-tsx.wasm")
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const tsxLanguage = await Language.load(tsxPath)
  const p = new Parser()
  p.setLanguage(tsxLanguage)
  return p
})

// Lazy-loaded Python parser
const pythonParser = lazy(async () => {
  const wasm = await import("web-tree-sitter")
  const Parser = (wasm as any).default ?? (wasm as any)
  const treePath = resolveWasmPath("web-tree-sitter/tree-sitter.wasm")
  await Parser.init({
    locateFile() {
      return treePath
    },
  })

  const pyPath = resolveWasmPath("tree-sitter-wasms/out/tree-sitter-python.wasm")
  const Language = (Parser as any).Language ?? (wasm as any).Language
  if (!Language?.load) {
    throw new Error("tree-sitter Language.load not available")
  }
  const pyLanguage = await Language.load(pyPath)
  const p = new Parser()
  p.setLanguage(pyLanguage)
  return p
})

export namespace TreeShaker {
  export interface Range {
    startLine: number
    endLine: number
  }

  export interface ShakeOptions {
    /** Absolute path to the file */
    filePath: string
    /** File content (if already read) */
    fileContent?: string
    /** Line ranges that should be kept expanded (1-indexed) */
    relevantRanges: Range[]
    /** How to render collapsed regions */
    collapseMode?: "comment" | "signature-only"
    /** Maximum output lines (0 = no limit) */
    maxLines?: number
    /** Pre-computed collapsible regions (avoids re-parsing) */
    precomputedRegions?: CollapsibleRegion[]
  }

  export interface ShakeResult {
    /** The shaked content */
    content: string
    /** Statistics about the shaking */
    stats: {
      totalLines: number
      visibleLines: number
      collapsedRegions: number
      hiddenLines: number
    }
  }

  /**
   * Represents a collapsible region in the code
   * Exported for pre-computation during indexing
   */
  export interface CollapsibleRegion {
    type: "method" | "function" | "constructor" | "arrow_function"
    name: string
    startLine: number // 1-indexed
    endLine: number // 1-indexed
    signatureEndLine: number // Line where signature ends (before body)
    indentation: string
  }

  /**
   * Check if file type is supported
   */
  export function isSupported(filePath: string): boolean {
    return (
      filePath.endsWith(".ts") ||
      filePath.endsWith(".tsx") ||
      filePath.endsWith(".js") ||
      filePath.endsWith(".jsx") ||
      filePath.endsWith(".py")
    )
  }

  /**
   * Check if two ranges overlap
   */
  function rangesOverlap(a: Range, b: Range): boolean {
    return a.startLine <= b.endLine && b.startLine <= a.endLine
  }

  /**
   * Extract the name of a node
   */
  function extractNodeName(node: SyntaxNode): string {
    // For method_definition, function_declaration
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "identifier" || child?.type === "property_identifier") {
        return child.text
      }
    }

    // For arrow functions in variable declarations
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child?.type === "variable_declarator") {
          const nameNode = child.child(0)
          if (nameNode?.type === "identifier") {
            return nameNode.text
          }
        }
      }
    }

    return "anonymous"
  }

  /**
   * Find the line where the function/method body starts (after signature)
   */
  function findSignatureEndLine(node: SyntaxNode, lines: string[]): number {
    // Look for the opening brace of the body
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "statement_block") {
        // The signature ends at the line before the block, or the same line if inline
        const blockStart = child.startPosition.row + 1 // 1-indexed
        // Check if the opening brace is on its own line
        const line = lines[child.startPosition.row]
        if (line?.trim() === "{") {
          return blockStart - 1
        }
        return blockStart
      }
    }
    return node.startPosition.row + 1
  }

  /**
   * Get indentation of a line
   */
  function getIndentation(line: string): string {
    const match = line.match(/^(\s*)/)
    return match ? match[1] : ""
  }

  /**
   * Get the appropriate parser for a file
   */
  async function getParserForFile(filePath: string) {
    if (filePath.endsWith(".py")) {
      return pythonParser()
    } else if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
      return tsxParser()
    }
    return tsParser()
  }

  /**
   * Extract collapsible regions from file content
   * Used during indexing to pre-compute regions
   */
  export async function extractRegions(filePath: string, content: string): Promise<CollapsibleRegion[]> {
    if (!isSupported(filePath)) {
      return []
    }

    const lines = content.split("\n")
    const parser = await getParserForFile(filePath)
    const tree = parser.parse(content)

    if (!tree) {
      return []
    }

    const isPython = filePath.endsWith(".py")
    return findCollapsibleRegions(tree, lines, isPython)
  }

  /**
   * Find all collapsible regions in the AST
   * Exported for pre-computation during indexing
   */
  export function findCollapsibleRegions(tree: Tree, lines: string[], isPython = false): CollapsibleRegion[] {
    const regions: CollapsibleRegion[] = []
    const rootNode = tree.rootNode as unknown as SyntaxNode

    function visit(node: SyntaxNode) {
      if (isPython) {
        // Python: function_definition, decorated_definition
        if (node.type === "function_definition") {
          const name = extractNodeName(node)
          const startLine = node.startPosition.row + 1
          const endLine = node.endPosition.row + 1
          const signatureEndLine = findPythonSignatureEndLine(node)
          const indentation = getIndentation(lines[node.startPosition.row] || "")

          // Check if it's a method (inside a class)
          const isMethod = node.parent?.type === "block" && 
                          node.parent?.parent?.type === "class_definition"

          regions.push({
            type: name === "__init__" ? "constructor" : (isMethod ? "method" : "function"),
            name,
            startLine,
            endLine,
            signatureEndLine,
            indentation,
          })
        }

        // Handle decorated definitions (wraps function_definition or class_definition)
        if (node.type === "decorated_definition") {
          // The actual function/class is a child, we'll visit it separately
          // Just need to adjust the start line to include decorators
        }
      } else {
        // TypeScript/JavaScript handling (existing logic)
        
        // Method definitions in classes
        if (node.type === "method_definition") {
          const name = extractNodeName(node)
          const startLine = node.startPosition.row + 1
          const endLine = node.endPosition.row + 1
          const signatureEndLine = findSignatureEndLine(node, lines)
          const indentation = getIndentation(lines[node.startPosition.row] || "")

          regions.push({
            type: name === "constructor" ? "constructor" : "method",
            name,
            startLine,
            endLine,
            signatureEndLine,
            indentation,
          })
        }

        // Function declarations
        if (node.type === "function_declaration") {
          const name = extractNodeName(node)
          const startLine = node.startPosition.row + 1
          const endLine = node.endPosition.row + 1
          const signatureEndLine = findSignatureEndLine(node, lines)
          const indentation = getIndentation(lines[node.startPosition.row] || "")

          regions.push({
            type: "function",
            name,
            startLine,
            endLine,
            signatureEndLine,
            indentation,
          })
        }

        // Arrow functions in const/let declarations (top-level or exported)
        if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
          const parent = node.parent
          if (parent?.type === "program" || parent?.type === "export_statement") {
            // Check if it contains an arrow function
            for (let i = 0; i < node.childCount; i++) {
              const declarator = node.child(i)
              if (declarator?.type === "variable_declarator") {
                for (let j = 0; j < declarator.childCount; j++) {
                  const value = declarator.child(j)
                  if (value?.type === "arrow_function") {
                    const name = extractNodeName(node)
                    const startLine = node.startPosition.row + 1
                    const endLine = node.endPosition.row + 1
                    const signatureEndLine = findSignatureEndLine(value, lines)
                    const indentation = getIndentation(lines[node.startPosition.row] || "")

                    regions.push({
                      type: "function",
                      name,
                      startLine,
                      endLine,
                      signatureEndLine,
                      indentation,
                    })
                  }
                }
              }
            }
          }
        }
      }

      // Recurse to children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) visit(child)
      }
    }

    visit(rootNode)

    // Sort by start line
    regions.sort((a, b) => a.startLine - b.startLine)

    return regions
  }

  /**
   * Find signature end line for Python functions
   * Python uses : to end the signature, body starts on next line (or same line for one-liners)
   */
  function findPythonSignatureEndLine(node: SyntaxNode): number {
    // Look for the body block
    const body = node.childForFieldName("body")
    if (body) {
      // The signature ends at the line before the body starts
      // Unless it's a one-liner
      const bodyStartLine = body.startPosition.row + 1
      const nodeStartLine = node.startPosition.row + 1
      if (bodyStartLine === nodeStartLine) {
        // One-liner, signature is the whole thing
        return nodeStartLine
      }
      return bodyStartLine - 1
    }
    return node.startPosition.row + 1
  }

  /**
   * Render the file with collapsed regions
   */
  function renderWithCollapsing(
    lines: string[],
    regions: CollapsibleRegion[],
    relevantRanges: Range[],
    collapseMode: "comment" | "signature-only"
  ): { content: string; stats: ShakeResult["stats"] } {
    const output: string[] = []
    let currentLine = 1
    let collapsedRegions = 0
    let hiddenLines = 0

    // Process each region
    for (const region of regions) {
      // Output lines before this region
      while (currentLine < region.startLine) {
        output.push(lines[currentLine - 1])
        currentLine++
      }

      // Check if this region overlaps with any relevant range
      const isRelevant = relevantRanges.some((range) =>
        rangesOverlap(range, { startLine: region.startLine, endLine: region.endLine })
      )

      if (isRelevant) {
        // Keep the entire region
        while (currentLine <= region.endLine) {
          output.push(lines[currentLine - 1])
          currentLine++
        }
      } else {
        // Collapse this region
        collapsedRegions++
        const bodyLines = region.endLine - region.signatureEndLine

        if (collapseMode === "signature-only") {
          // Show only the signature line(s)
          while (currentLine <= region.signatureEndLine) {
            output.push(lines[currentLine - 1])
            currentLine++
          }
          // Add collapsed indicator
          const hiddenCount = region.endLine - region.signatureEndLine
          if (hiddenCount > 0) {
            output.push(`${region.indentation}  // ... (${hiddenCount} lines hidden) ...`)
            hiddenLines += hiddenCount
          }
          // Skip the body
          currentLine = region.endLine + 1
        } else {
          // comment mode: show a single comment line
          output.push(
            `${region.indentation}// ... (${region.name}: ${bodyLines} lines hidden) ...`
          )
          hiddenLines += region.endLine - region.startLine + 1
          currentLine = region.endLine + 1
        }
      }
    }

    // Output remaining lines after last region
    while (currentLine <= lines.length) {
      output.push(lines[currentLine - 1])
      currentLine++
    }

    return {
      content: output.join("\n"),
      stats: {
        totalLines: lines.length,
        visibleLines: output.length,
        collapsedRegions,
        hiddenLines,
      },
    }
  }

  /**
   * Main entry point: shake a file to show only relevant regions
   */
  export async function shake(options: ShakeOptions): Promise<ShakeResult> {
    const { filePath, relevantRanges, collapseMode = "comment", maxLines = 0, precomputedRegions } = options

    // Check if supported
    if (!isSupported(filePath)) {
      log.warn("tree-shaker: unsupported file type", { filePath })
      // Return original content for unsupported files
      const content = options.fileContent ?? (await readFile(filePath, "utf-8"))
      const lines = content.split("\n")
      return {
        content,
        stats: {
          totalLines: lines.length,
          visibleLines: lines.length,
          collapsedRegions: 0,
          hiddenLines: 0,
        },
      }
    }

    // Read file if not provided
    const content = options.fileContent ?? (await readFile(filePath, "utf-8"))
    const lines = content.split("\n")

    // If no relevant ranges, return everything (edge case)
    if (relevantRanges.length === 0) {
      return {
        content,
        stats: {
          totalLines: lines.length,
          visibleLines: lines.length,
          collapsedRegions: 0,
          hiddenLines: 0,
        },
      }
    }

    // Use pre-computed regions if available, otherwise parse the file
    let regions: CollapsibleRegion[]
    
    if (precomputedRegions && precomputedRegions.length > 0) {
      // Use cached regions - no parsing needed!
      regions = precomputedRegions
      log.info("tree-shaker: using pre-computed regions (no parse)", {
        filePath: path.basename(filePath),
        regions: regions.length,
      })
    } else {
      // Parse the file to extract regions
      const isPython = filePath.endsWith(".py")
      const parser = await getParserForFile(filePath)
      const tree = parser.parse(content)

      if (!tree) {
        log.warn("tree-shaker: failed to parse file", { filePath })
        return {
          content,
          stats: {
            totalLines: lines.length,
            visibleLines: lines.length,
            collapsedRegions: 0,
            hiddenLines: 0,
          },
        }
      }

      // Find collapsible regions
      regions = findCollapsibleRegions(tree, lines, isPython)

      log.info("tree-shaker: parsed and found collapsible regions", {
        filePath: path.basename(filePath),
        regions: regions.length,
        relevantRanges: relevantRanges.length,
      })
    }

    // Render with collapsing
    const result = renderWithCollapsing(lines, regions, relevantRanges, collapseMode)

    // Apply max lines limit if specified
    if (maxLines > 0 && result.stats.visibleLines > maxLines) {
      const outputLines = result.content.split("\n")
      const truncated = outputLines.slice(0, maxLines)
      truncated.push(`// ... (${outputLines.length - maxLines} more lines) ...`)
      result.content = truncated.join("\n")
      result.stats.visibleLines = maxLines + 1
    }

    log.info("tree-shaker: completed", {
      filePath: path.basename(filePath),
      stats: result.stats,
    })

    return result
  }

  /**
   * Shake multiple search results grouped by file
   */
  export async function shakeResults(
    results: Array<{
      file: string
      startLine: number
      endLine: number
      content: string
      metadata: Record<string, unknown>
    }>,
    rootDir: string,
    /** Pre-computed collapsible regions per file (from index) */
    precomputedRegionsMap?: Map<string, CollapsibleRegion[]>
  ): Promise<
    Array<{
      file: string
      shakedContent: string
      originalResults: typeof results
      stats: ShakeResult["stats"]
    }>
  > {
    // Group results by file
    const byFile = new Map<string, typeof results>()
    for (const result of results) {
      const list = byFile.get(result.file) ?? []
      list.push(result)
      byFile.set(result.file, list)
    }

    // Process each file
    const output: Array<{
      file: string
      shakedContent: string
      originalResults: typeof results
      stats: ShakeResult["stats"]
    }> = []

    for (const [file, fileResults] of byFile) {
      const filePath = path.isAbsolute(file) ? file : path.join(rootDir, file)

      // Collect all relevant ranges from this file's results
      const relevantRanges: Range[] = fileResults.map((r) => ({
        startLine: r.startLine,
        endLine: r.endLine,
      }))

      // Get pre-computed regions for this file if available
      const precomputedRegions = precomputedRegionsMap?.get(file)

      try {
        const shakeResult = await shake({
          filePath,
          relevantRanges,
          precomputedRegions,
        })

        output.push({
          file,
          shakedContent: shakeResult.content,
          originalResults: fileResults,
          stats: shakeResult.stats,
        })
      } catch (error) {
        log.error("tree-shaker: failed to shake file", {
          file,
          error: String(error),
        })
        // Fallback: return original content concatenated
        output.push({
          file,
          shakedContent: fileResults.map((r) => r.content).join("\n\n---\n\n"),
          originalResults: fileResults,
          stats: {
            totalLines: 0,
            visibleLines: 0,
            collapsedRegions: 0,
            hiddenLines: 0,
          },
        })
      }
    }

    return output
  }
}
