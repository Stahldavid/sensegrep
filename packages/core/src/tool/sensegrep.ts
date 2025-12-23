import z from "zod"
import { Tool } from "./tool"
import { VectorStore } from "@/semantic/lancedb"
import { Indexer } from "@/semantic/indexer"
import { Instance } from "@/project/instance"
import { Embeddings } from "@/semantic/embeddings"
import { Ripgrep } from "@/file/ripgrep"
import path from "path"

import DESCRIPTION from "./sensegrep.txt"

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

  const proc = Bun.spawn([rgPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const output = await new Response(proc.stdout).text()
  await proc.exited

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

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Natural language query to search for semantically similar code/content"),
    pattern: z.string().optional().describe("Optional regex pattern for keyword matching (BM25-style)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 20)"),
    include: z.string().optional().describe('File pattern to filter results (e.g. "*.ts", "src/**/*.tsx")'),
    rerank: z.boolean().default(false).describe("Enable cross-encoder reranking (default: false)"),

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
  }),
  async execute(params, _ctx) {
    const limit = params.limit ?? 20
    const shouldRerank = params.rerank === true

    // Check if index exists
    const hasIndex = await Indexer.hasIndex()
    if (!hasIndex) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: false },
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    // Get collection
    const collection = await VectorStore.getCollection(Instance.directory)

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
      const glob = new Bun.Glob(params.include)
      semanticResults = semanticResults.filter((r) => glob.match(r.metadata.file as string))
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

    // Take top results
    const finalResults = rankedResults.slice(0, limit)

    if (finalResults.length === 0) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true },
        output: "No matching results found for your query.",
      }
    }

    // Format output - balanced with essential info + code
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
  },
})
