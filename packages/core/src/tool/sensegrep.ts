import z from "zod"
import { readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { once } from "node:events"
import picomatch from "picomatch"
import { Tool } from "./tool.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { Ripgrep } from "../file/ripgrep.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import path from "path"

const DESCRIPTION = readFileSync(new URL("./sensegrep.txt", import.meta.url), "utf8")

const MAX_LINE_LENGTH = 2000

// Helper: Run ripgrep only on specific files (post-filter approach)
async function runRipgrepOnFiles(
  pattern: string,
  files: string[],
): Promise<{ file: string; line: number; text: string }[]> {
  if (files.length === 0) return []

  const rgPath = await Ripgrep.filepath()
  const args = [
    "-n", // Line numbers
    "-i", // Case insensitive always
    "--no-heading", // Simple format: file:line:text
    "--regexp",
    pattern,
  ]

  // Add each file as argument
  for (const file of files) {
    const fullPath = path.join(Instance.directory, file)
    args.push(fullPath)
  }

  const proc = spawn(rgPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  })

  let output = ""
  let stderr = ""
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  const [code] = (await once(proc, "close")) as [number]
  if (code && code !== 1) {
    throw new Error(`ripgrep failed with code ${code}: ${stderr}`)
  }

  // Parse output: "file:line:text"
  const matches: { file: string; line: number; text: string }[] = []
  for (const line of output.trim().split("\n")) {
    if (!line) continue
    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (match) {
      const [, fullPath, lineNum, text] = match
      const relativePath = path.relative(Instance.directory, fullPath)
      matches.push({
        file: relativePath,
        line: parseInt(lineNum, 10),
        text: text.trim(),
      })
    }
  }
  return matches
}

function overlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1)
  const lenA = Math.max(1, aEnd - aStart + 1)
  const lenB = Math.max(1, bEnd - bStart + 1)
  const minLen = Math.min(lenA, lenB)
  return overlap / minLen
}

function dedupeOverlapping<T extends {
  file: string
  startLine: number
  endLine: number
  semanticScore: number
  metadata: Record<string, unknown>
}>(results: T[], options?: { overlapThreshold?: number; scoreSlack?: number }): T[] {
  const overlapThreshold = options?.overlapThreshold ?? 0.6
  const scoreSlack = options?.scoreSlack ?? 0.02
  const byFile = new Map<string, T[]>()
  const kept: T[] = []

  for (const result of results) {
    const list = byFile.get(result.file) ?? []
    let replaced = false
    let skip = false

    for (let i = 0; i < list.length; i++) {
      const existing = list[i]
      const ratio = overlapRatio(result.startLine, result.endLine, existing.startLine, existing.endLine)
      if (ratio < overlapThreshold) continue

      const scoreDiff = result.semanticScore - existing.semanticScore
      const resultType = String(result.metadata.symbolType ?? "")
      const existingType = String(existing.metadata.symbolType ?? "")
      const resultLen = result.endLine - result.startLine + 1
      const existingLen = existing.endLine - existing.startLine + 1

      let preferResult = scoreDiff > scoreSlack
      if (!preferResult && Math.abs(scoreDiff) <= scoreSlack) {
        if (resultType === "method" && existingType === "class") {
          preferResult = true
        } else if (resultType === "function" && existingType === "class") {
          preferResult = true
        } else if (resultLen < existingLen) {
          preferResult = true
        }
      }

      if (preferResult) {
        list[i] = result
        replaced = true
      } else {
        skip = true
      }
      break
    }

    if (!skip) {
      if (!replaced) list.push(result)
      byFile.set(result.file, list)
    }
  }

  for (const list of byFile.values()) {
    kept.push(...list)
  }

  return kept
}

function diversifyResults<T extends {
  file: string
  metadata: Record<string, unknown>
}>(results: T[], limits: { maxPerFile: number; maxPerSymbol: number }): T[] {
  const { maxPerFile, maxPerSymbol } = limits
  const kept: T[] = []
  const perFile = new Map<string, number>()
  const perSymbol = new Map<string, number>()

  for (const result of results) {
    const file = result.file || ""
    const symbolName = typeof result.metadata.symbolName === "string" ? result.metadata.symbolName : ""

    if (maxPerFile > 0) {
      const fileCount = perFile.get(file) ?? 0
      if (fileCount >= maxPerFile) continue
      perFile.set(file, fileCount + 1)
    }

    if (maxPerSymbol > 0 && symbolName) {
      const symbolCount = perSymbol.get(symbolName) ?? 0
      if (symbolCount >= maxPerSymbol) continue
      perSymbol.set(symbolName, symbolCount + 1)
    }

    kept.push(result)
  }

  return kept
}

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Natural language query to search for semantically similar code/content"),
    pattern: z.string().optional().describe("Optional regex pattern for keyword matching (BM25-style)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 20)"),
    include: z.string().optional().describe('File pattern to filter results (e.g. "*.ts", "src/**/*.tsx")'),
    rerank: z.boolean().default(false).describe("Enable cross-encoder reranking (default: false)"),
    minScore: z.number().optional().describe("Minimum relevance score 0-1 (filters low-confidence results)"),
    symbol: z.string().optional().describe('Filter by symbol name (e.g. "VectorStore")'),
    name: z.string().optional().describe('Alias for "symbol"'),
    maxPerFile: z.number().optional().describe("Maximum results per file (default: 1)"),
    maxPerSymbol: z.number().optional().describe("Maximum results per symbol (default: 1)"),

    // Semantic metadata filters
    symbolType: z
      .enum(["function", "class", "method", "interface", "type", "variable", "namespace", "enum"])
      .optional()
      .describe('Filter by symbol type (e.g. "function", "class", "method")'),
    isExported: z.boolean().optional().describe("Filter for exported symbols only"),
    minComplexity: z.number().optional().describe("Minimum cyclomatic complexity (e.g. 5 for moderately complex code)"),
    maxComplexity: z.number().optional().describe("Maximum cyclomatic complexity"),
    hasDocumentation: z.boolean().optional().describe("Filter for code with/without documentation"),
    language: z
      .enum(["typescript", "javascript", "tsx", "jsx"])
      .optional()
      .describe('Filter by programming language (e.g. "typescript")'),
    parentScope: z.string().optional().describe('Filter by parent scope/class (e.g. "VectorStore")'),
    imports: z.string().optional().describe('Filter by imported module name (e.g. "react")'),
    shake: z.boolean().default(true).describe("Enable semantic tree-shaking to show full file context with irrelevant regions collapsed (default: true)"),
  }),
  async execute(params, _ctx) {
    // Read index metadata first (before any embedding initialization)
    const meta = await VectorStore.readIndexMeta(Instance.directory)
    if (!meta || !meta.embeddings) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: false },
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    // Configure embeddings to match the index
    const indexConfig = {
      provider: meta.embeddings.provider,
      embedModel: meta.embeddings.model,
      embedDim: meta.embeddings.dimension,
      ...(meta.embeddings.device ? { device: meta.embeddings.device } : {}),
    }

    const run = async () => {
    // Clear any cached tables that might have wrong dimension expectations
    VectorStore.clearProjectCache(Instance.directory)

    const limit = params.limit ?? 20
    const shouldRerank = params.rerank === true

    // Get collection, passing the expected dimension from index metadata
    const collection = await VectorStore.getCollectionUnsafe(Instance.directory, meta.embeddings.dimension)

    // Build semantic filters from parameters
    const filters: VectorStore.SearchFilters = { all: [] }

    if (params.symbolType) {
      filters.all!.push({ key: "symbolType", operator: "equals", value: params.symbolType })
    }

    if (params.isExported !== undefined) {
      filters.all!.push({ key: "isExported", operator: "equals", value: params.isExported })
    }

    if (params.minComplexity !== undefined) {
      filters.all!.push({ key: "complexity", operator: "greater_or_equal", value: params.minComplexity })
    }

    if (params.maxComplexity !== undefined) {
      filters.all!.push({ key: "complexity", operator: "less_or_equal", value: params.maxComplexity })
    }

    if (params.hasDocumentation !== undefined) {
      filters.all!.push({ key: "hasDocumentation", operator: "equals", value: params.hasDocumentation })
    }

    if (params.language) {
      filters.all!.push({ key: "language", operator: "equals", value: params.language })
    }

    if (params.parentScope) {
      filters.all!.push({ key: "parentScope", operator: "equals", value: params.parentScope })
    }
    if (params.imports) {
      filters.all!.push({ key: "imports", operator: "contains", value: params.imports })
    }
    const symbolQuery = params.symbol ?? params.name
    if (symbolQuery) {
      filters.all!.push({ key: "symbolName", operator: "contains", value: symbolQuery })
    }

    // Only pass filters if we have any
    const searchOptions: { limit: number; filters?: VectorStore.SearchFilters } = {
      limit: params.pattern ? limit * 3 : limit * 2, // Get more if we need to post-filter
    }
    if (filters.all && filters.all.length > 0) {
      searchOptions.filters = filters
    }

    // Step 1: Semantic search with metadata filters
    let semanticResults = await VectorStore.search(collection, params.query, searchOptions)

    // Apply include filter if specified (file glob pattern)
    if (params.include) {
      const matcher = picomatch(params.include, { dot: true })
      semanticResults = semanticResults.filter((r) => matcher(r.metadata.file as string))
    }

    // Step 2: Post-filter with ripgrep if pattern provided
    // This runs ripgrep ONLY on files found by semantic search
    let filteredResults = semanticResults
    if (params.pattern && semanticResults.length > 0) {
      const uniqueFiles = [...new Set(semanticResults.map((r) => r.metadata.file as string))]
      const rgMatches = await runRipgrepOnFiles(params.pattern, uniqueFiles)

      // Keep only chunks that contain ripgrep matches (line within chunk range)
      filteredResults = semanticResults.filter((r) => {
        const file = r.metadata.file as string
        const startLine = r.metadata.startLine as number
        const endLine = r.metadata.endLine as number
        return rgMatches.some((m) => m.file === file && m.line >= startLine && m.line <= endLine)
      })
    }

    // Convert to working format with semantic score
    type WorkingResult = {
      file: string
      content: string
      startLine: number
      endLine: number
      semanticScore: number
      metadata: Record<string, string | number | boolean | undefined>
      rerankScore?: number
    }
    let workingResults: WorkingResult[] = filteredResults.map((r) => ({
      file: r.metadata.file as string,
      content: r.content,
      startLine: r.metadata.startLine as number,
      endLine: r.metadata.endLine as number,
      semanticScore: 1 - r.distance, // Convert distance to similarity
      metadata: r.metadata,
    }))

    // Sort by semantic score initially
    workingResults.sort((a, b) => b.semanticScore - a.semanticScore)

    // Optional rerank (cross-encoder) on top-N candidates
    let rankedResults = workingResults
    if (shouldRerank && workingResults.length > 1) {
      const candidateCount = Math.min(Math.max(limit, 20), 100, workingResults.length)
      const candidates = workingResults.slice(0, candidateCount)
      const rerankScores = await Embeddings.rerank(
        params.query,
        candidates.map((c) => c.content),
      )
      const scoreByIndex = new Map<number, number>()
      for (const s of rerankScores) scoreByIndex.set(s.index, s.score)
      const reranked = candidates
        .map((c, i) => ({
          ...c,
          rerankScore: scoreByIndex.get(i) ?? 0,
        }))
        .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      const remainder = workingResults.slice(candidateCount)
      rankedResults = [...reranked, ...remainder]
    }

    const minScore = typeof params.minScore === "number" ? params.minScore : undefined
    if (minScore !== undefined) {
      rankedResults = rankedResults.filter((r) => (r.rerankScore ?? r.semanticScore) >= minScore)
    }

    // Dedupe overlapping results within the same file (class vs method, etc.)
    const dedupedResults = dedupeOverlapping(rankedResults)

    // Enforce diversity across file/symbol to avoid repeating the same source
    const maxPerFile = typeof params.maxPerFile === "number" ? Math.max(0, params.maxPerFile) : 1
    const maxPerSymbol = typeof params.maxPerSymbol === "number" ? Math.max(0, params.maxPerSymbol) : 1
    const diversifiedResults = diversifyResults(dedupedResults, { maxPerFile, maxPerSymbol })

    // Take top results
    const finalResults = diversifiedResults.slice(0, limit)

    if (finalResults.length === 0) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true },
        output: "No matching results found for your query.",
      }
    }

    // Apply semantic tree-shaking if enabled (default: true)
    const shouldShake = params.shake !== false
    
    if (shouldShake) {
      // Get pre-computed collapsible regions from the index
      const indexMeta = await VectorStore.readIndexMeta(Instance.directory)
      const precomputedRegionsMap = new Map<string, TreeShaker.CollapsibleRegion[]>()
      
      if (indexMeta?.files) {
        // Build map of file -> collapsible regions
        for (const result of finalResults) {
          const fileStat = indexMeta.files[result.file]
          if (fileStat?.collapsibleRegions) {
            precomputedRegionsMap.set(result.file, fileStat.collapsibleRegions as TreeShaker.CollapsibleRegion[])
          }
        }
      }

      // Group results by file and apply tree-shaking
      const shakedResults = await TreeShaker.shakeResults(
        finalResults.map((r) => ({
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          content: r.content,
          metadata: r.metadata as Record<string, unknown>,
        })),
        Instance.directory,
        precomputedRegionsMap.size > 0 ? precomputedRegionsMap : undefined
      )

      // Format output with shaked content
      const outputLines = [`Found ${finalResults.length} results across ${shakedResults.length} files\n`]

      for (const shaked of shakedResults) {
        // File header with stats
        const statsInfo = shaked.stats.collapsedRegions > 0
          ? ` (${shaked.stats.hiddenLines} lines hidden in ${shaked.stats.collapsedRegions} regions)`
          : ""
        outputLines.push(`## ${shaked.file}${statsInfo}`)

        // Show metadata for the relevant matches in this file
        const metaParts: string[] = []
        for (const result of shaked.originalResults) {
          const meta = result.metadata
          const symbolInfo = [meta.symbolName, meta.symbolType].filter(Boolean).join(" ")
          if (symbolInfo) metaParts.push(symbolInfo)
        }
        if (metaParts.length > 0) {
          outputLines.push(`Matches: ${metaParts.join(", ")}`)
        }

        outputLines.push("```")

        // Show shaked content (already collapsed)
        const lines = shaked.shakedContent.split("\n")
        for (const line of lines.slice(0, 100)) {
          const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
          outputLines.push(truncated)
        }
        if (lines.length > 100) {
          outputLines.push(`// ... (${lines.length - 100} more lines) ...`)
        }

        outputLines.push("```\n")
      }

      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          files: shakedResults.length,
          indexed: true,
          shaked: true,
        },
        output: outputLines.join("\n"),
      }
    }

    // Fallback: original formatting without tree-shaking
    const outputLines = [`Found ${finalResults.length} results\n`]

    for (const result of finalResults) {
      const meta = result.metadata

      // File location with symbol hints
      const hints = []
      if (meta.symbolName) hints.push(meta.symbolName)
      if (meta.symbolType) hints.push(meta.symbolType)

      const location =
        hints.length > 0
          ? `${result.file}:${result.startLine} (${hints.join(", ")})`
          : `${result.file}:${result.startLine}-${result.endLine}`

      outputLines.push(`## ${location}`)

      // Show selective metadata: score + important attributes
      const metaParts = []

      // Always show relevance score
      metaParts.push(`Relevance: ${(result.semanticScore * 100).toFixed(1)}%`)
      if (result.rerankScore !== undefined) {
        metaParts.push(`Rerank: ${result.rerankScore.toFixed(3)}`)
      }

      // Show complexity if it's significant or was filtered
      if (typeof meta.complexity === "number" && meta.complexity > 0) {
        metaParts.push(`Complexity: ${meta.complexity}`)
      }

      // Show if it's a method (has parent scope)
      if (meta.parentScope && typeof meta.parentScope === "string") {
        metaParts.push(`in ${meta.parentScope}`)
      }

      if (metaParts.length > 0) {
        outputLines.push(metaParts.join(" | "))
      }

      outputLines.push("```")

      // Show actual code content
      const lines = result.content.split("\n")
      for (const line of lines.slice(0, 30)) {
        const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
        outputLines.push(truncated)
      }
      if (lines.length > 30) {
        outputLines.push(`... (${lines.length - 30} more lines)`)
      }

      outputLines.push("```\n")
    }

      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          indexed: true,
        },
        output: outputLines.join("\n"),
      }
    }

    // Use withConfig to match index embeddings and ensure proper cleanup
    return Embeddings.withConfig(indexConfig as any, run)
  },
})
