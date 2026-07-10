import z from "zod"
import { readFileSync } from "node:fs"
import { Tool } from "./tool.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import { Log } from "../util/log.js"
import {
  annotateWorkingResults,
  canonicalizeProjectFilePath,
  collectLiteralFallbackResults,
  collectRipgrepFallbackResults,
  createGlobMatcher,
  dedupeOverlapping,
  diversifyResults,
  expandFilePathVariants,
  expandImportFilterValues,
  formatFreshnessWarning,
  getFreshnessSummary,
  getScopedFilePath,
  matchesScopedGlob,
  prependFreshnessWarning,
  queryLooksLikeIdentifier,
  runRipgrepOnFiles,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"
import { expandSemanticKindFilter } from "../semantic/language/index.js"

const DESCRIPTION = readFileSync(new URL("./sensegrep.txt", import.meta.url), "utf8")
const log = Log.create({ service: "tool.sensegrep" })

const MAX_LINE_LENGTH = 2000

function queryLooksLikeSimpleIdentifier(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed.length > 120) return false
  if (/\s/.test(trimmed)) return false
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) return false
  return /[A-Za-z]/.test(trimmed)
}

async function collectExactSymbolResults(
  symbolName: string,
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
): Promise<
  {
    id: string
    file: string
    content: string
    startLine: number
    endLine: number
    semanticScore: number
    metadata: Record<string, string | number | boolean | string[] | undefined>
  }[]
> {
  const exactFilters: VectorStore.SearchFilters = {
    ...filters,
    all: [...(filters.all ?? []), { key: "symbolName", operator: "equals", value: symbolName }],
  }
  const rows = await VectorStore.listDocuments(collection, { filters: exactFilters })
  return rows.map((row) => ({
    id: row.id,
    file: row.metadata.file as string,
    content: row.content,
    startLine: row.metadata.startLine as number,
    endLine: row.metadata.endLine as number,
    semanticScore: 1.08,
    metadata: row.metadata,
  }))
}

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().trim().min(1).describe("Natural language query to search for semantically similar code/content"),
    pattern: z.string().optional().describe("Optional regex pattern for keyword matching (BM25-style)"),
    limit: z.number().int().positive().max(500).optional().describe("Maximum number of results to return (default: 10)"),
    maxPerFile: z.number().int().nonnegative().optional().describe("Maximum results per file (default: 2)"),
    maxPerSymbol: z.number().int().nonnegative().optional().describe("Maximum results per symbol (default: 2)"),

    include: z.string().optional().describe('File glob include filter (e.g. "*.ts", "src/**/*.tsx")'),
    exclude: z.string().optional().describe('File glob exclude filter (e.g. "*.md", "docs/**")'),
    rerank: z.boolean().default(false).describe("Compatibility flag. Remote-only mode does not perform reranking."),
    minScore: z.number().min(0).max(1).optional().describe("Minimum relevance score 0-1 (filters low-confidence results)"),
    symbol: z.string().optional().describe('Filter by symbol name (e.g. "VectorStore")'),
    name: z.string().optional().describe('Alias for "symbol"'),
    exact: z.boolean().optional().describe("Prefer exact symbol-name lookup for identifier queries"),


    // Semantic metadata filters
    symbolType: z
      .enum(["function", "class", "method", "type", "variable", "enum", "module"])
      .optional()
      .describe('Filter by semantic symbol type (universal across languages)'),
    variant: z
      .string()
      .optional()
      .describe('Filter by symbol variant (e.g. "interface", "dataclass", "async", "static")'),
    isExported: z.boolean().optional().describe("Filter for exported/public symbols only"),
    isAsync: z.boolean().optional().describe("Filter for async functions/methods"),
    isStatic: z.boolean().optional().describe("Filter for static methods"),
    isAbstract: z.boolean().optional().describe("Filter for abstract classes/methods"),
    decorator: z.string().optional().describe('Filter by decorator (e.g. "@property", "@dataclass")'),
    minComplexity: z.number().nonnegative().optional().describe("Minimum cyclomatic complexity (e.g. 5 for moderately complex code)"),
    maxComplexity: z.number().nonnegative().optional().describe("Maximum cyclomatic complexity"),
    hasDocumentation: z.boolean().optional().describe("Filter for code with/without documentation"),
    language: z
      .enum(["typescript", "javascript", "python", "java", "vue"])
      .optional()
      .describe('Filter by programming language'),
    parentScope: z.string().optional().describe('Filter by parent scope/class (e.g. "VectorStore")'),
    imports: z.string().optional().describe('Filter by imported module name (e.g. "react")'),
    semanticKind: z.string().optional().describe('Filter by framework-aware kind (e.g. "convexMutation", "reactComponent", "routeHandler")'),
    explainFilters: z.boolean().optional().describe("Include deterministic filter match explanations in JSON results"),
    strictParent: z.boolean().optional().describe("Require strict parent metadata when filtering by parent"),
    strictImports: z.boolean().optional().describe("Require strict import metadata when filtering by imports"),
    shake: z.boolean().default(true).describe("Enable semantic tree-shaking to show full file context with irrelevant regions collapsed (default: true)"),
  }),
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    // Read index metadata first (before any embedding initialization)
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta.embeddings) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: false },
        results: [],
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    const meta = resolved.meta

    // Configure embeddings to match the index
    const indexConfig = {
      provider: meta.embeddings.provider,
      embedModel: meta.embeddings.model,
      embedDim: meta.embeddings.dimension,
    }

    const run = async () => {
    const startedAt = Date.now()
    const metrics: Record<string, number> = {}
    const warnings: string[] = []
    // Clear any cached tables that might have wrong dimension expectations
    VectorStore.clearProjectCache(resolved.root)
    const freshness = await getFreshnessSummary()
    const freshnessWarning = formatFreshnessWarning(freshness)
    if (freshnessWarning) warnings.push(freshnessWarning)

    const limit = params.limit ?? 10
    const shouldRerank = params.rerank === true

    // Get collection, passing the expected dimension from index metadata
    const collectionStartedAt = Date.now()
    const collection = await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)
    metrics.collectionMs = Date.now() - collectionStartedAt

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

    // New multilingual filters
    if (params.variant) {
      filters.all!.push({ key: "variant", operator: "equals", value: params.variant })
    }

    if (params.isAsync !== undefined) {
      filters.all!.push({ key: "isAsync", operator: "equals", value: params.isAsync })
    }

    if (params.isStatic !== undefined) {
      filters.all!.push({ key: "isStatic", operator: "equals", value: params.isStatic })
    }

    if (params.isAbstract !== undefined) {
      filters.all!.push({ key: "isAbstract", operator: "equals", value: params.isAbstract })
    }

    if (params.decorator) {
      filters.all!.push({ key: "decorators", operator: "contains", value: params.decorator })
    }

    if (params.parentScope) {
      filters.all!.push({ key: "parentScope", operator: "contains", value: params.parentScope })
    }
    if ((params as any).semanticKind) {
      const semanticKinds = expandSemanticKindFilter(String((params as any).semanticKind))
      if (semanticKinds.length === 1) {
        filters.all!.push({ key: "semanticKind", operator: "equals", value: semanticKinds[0] })
      } else if (semanticKinds.length > 1) {
        filters.any = [
          ...(filters.any ?? []),
          ...semanticKinds.map((value) => ({ key: "semanticKind", operator: "equals" as const, value })),
        ]
      } else {
        filters.all!.push({ key: "semanticKind", operator: "equals", value: (params as any).semanticKind })
      }
    }
    if (params.imports) {
      const importValues = expandImportFilterValues(params.imports)
      if (importValues.length === 1) {
        filters.all!.push({ key: "imports", operator: "contains", value: importValues[0] })
      } else if (importValues.length > 1) {
        filters.any = [
          ...(filters.any ?? []),
          ...importValues.map((value) => ({ key: "imports", operator: "contains" as const, value })),
        ]
      }
    }
    const symbolQuery = params.symbol ?? params.name
    if (symbolQuery) {
      filters.all!.push({ key: "symbolName", operator: "contains", value: symbolQuery })
    }

    let includeMatcher: ReturnType<typeof createGlobMatcher> | undefined
    let excludeMatcher: ReturnType<typeof createGlobMatcher> | undefined
    if (params.include) includeMatcher = createGlobMatcher(params.include)
    if (params.exclude) excludeMatcher = createGlobMatcher(params.exclude)

    let candidateFiles: string[] | undefined
    if (includeMatcher || excludeMatcher || resolved.subdirPrefix) {
      const indexedFiles = Object.keys(meta.files ?? {})
      candidateFiles = indexedFiles.filter((file) => {
        if (getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
        if (!matchesScopedGlob(file, includeMatcher, resolved.subdirPrefix)) return false
        if (excludeMatcher && matchesScopedGlob(file, excludeMatcher, resolved.subdirPrefix)) return false
        return true
      })

      if (candidateFiles.length === 0) {
        const filterLabel = [
          params.include ? `include="${params.include}"` : null,
          params.exclude ? `exclude="${params.exclude}"` : null,
          resolved.subdirPrefix ? `scope="${resolved.subdirPrefix}"` : null,
        ]
          .filter(Boolean)
          .join(", ")
        const warning = `No indexed files matched the file filters${filterLabel ? ` (${filterLabel})` : ""}.`
        warnings.push(warning)
        metrics.totalMs = Date.now() - startedAt
        return {
          title: params.query,
          metadata: { matches: 0, indexed: true, freshness, warnings, metrics },
          freshness,
          warnings,
          metrics,
          results: [],
          output: prependFreshnessWarning(
            warning,
            freshness,
          ),
        }
      }

      const fileFilterValues = [...new Set(candidateFiles.flatMap((file) => expandFilePathVariants(file)))]
      filters.all!.push({ key: "file", operator: "in", value: fileFilterValues })
    }

    // Only pass filters if we have any
    const searchOptions: { limit: number; filters?: VectorStore.SearchFilters } = {
      limit: params.pattern ? limit * 3 : limit * 2, // Get more if we need to post-filter
    }
    if ((filters.all && filters.all.length > 0) || (filters.any && filters.any.length > 0)) {
      searchOptions.filters = filters
    }

    const shouldRunLiteralFallback = !params.pattern && queryLooksLikeIdentifier(params.query)
    const simpleIdentifierQuery = queryLooksLikeSimpleIdentifier(params.query)
    const exactSymbolQuery = symbolQuery ?? (params.exact || simpleIdentifierQuery ? params.query.trim() : undefined)
    let exactSymbolResults: WorkingResult[] = []
    if (exactSymbolQuery) {
      const exactStartedAt = Date.now()
      const symbolResults = await collectExactSymbolResults(exactSymbolQuery, collection, filters)
      metrics.exactSymbolLookupMs = Date.now() - exactStartedAt
      exactSymbolResults = symbolResults.map((result) => ({
        file: result.file,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
        semanticScore: result.semanticScore,
        metadata: result.metadata,
        whyMatched: [`exact symbol lookup: ${exactSymbolQuery}`],
      }))
    }
    let literalFallbackResults: WorkingResult[] = []
    const lexicalCandidateFiles =
      shouldRunLiteralFallback || params.pattern
        ? candidateFiles ??
          Object.keys(meta.files ?? {}).filter((file) => {
            if (getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
            if (!matchesScopedGlob(file, includeMatcher, resolved.subdirPrefix)) return false
            if (excludeMatcher && matchesScopedGlob(file, excludeMatcher, resolved.subdirPrefix)) return false
            return true
          })
        : []

    if (shouldRunLiteralFallback) {
      const literalStartedAt = Date.now()
      const literalResults = await collectLiteralFallbackResults(params.query, lexicalCandidateFiles, collection, filters)
      metrics.literalFallbackMs = Date.now() - literalStartedAt
      literalFallbackResults = literalResults.map((result) => ({
        file: result.file,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
        semanticScore: result.semanticScore,
        metadata: result.metadata,
        whyMatched: result.whyMatched,
      }))
    }

    const useLexicalOnly =
      !params.pattern &&
      (exactSymbolResults.length > 0 || literalFallbackResults.length > 0) &&
      (params.exact === true || Boolean(symbolQuery) || (simpleIdentifierQuery && exactSymbolResults.length > 0))

    // Step 1: Semantic search with metadata filters. Explicit exact/literal hits can skip embeddings entirely.
    let semanticResults: Awaited<ReturnType<typeof VectorStore.search>> = []
    if (!useLexicalOnly) {
      const semanticStartedAt = Date.now()
      semanticResults = await VectorStore.search(collection, params.query, {
        ...searchOptions,
        signal: ctx.abort,
      })
      metrics.semanticSearchMs = Date.now() - semanticStartedAt

      // Apply file globs again as a safety net after semantic search.
      if (includeMatcher) {
        semanticResults = semanticResults.filter((r) =>
          matchesScopedGlob(r.metadata.file as string, includeMatcher, resolved.subdirPrefix),
        )
      }
      if (excludeMatcher) {
        semanticResults = semanticResults.filter((r) =>
          !matchesScopedGlob(r.metadata.file as string, excludeMatcher, resolved.subdirPrefix),
        )
      }
    } else {
      metrics.semanticSearchMs = 0
    }

    // Step 2: Post-filter with ripgrep if pattern provided
    // This runs ripgrep ONLY on files found by semantic search
    let filteredResults = semanticResults
    if (params.pattern && semanticResults.length > 0) {
      const patternFilterStartedAt = Date.now()
      const uniqueFiles = [...new Set(semanticResults.map((r) => r.metadata.file as string))]
      const rgMatches = await runRipgrepOnFiles(params.pattern, uniqueFiles)

      // Keep only chunks that contain ripgrep matches (line within chunk range)
      filteredResults = semanticResults.filter((r) => {
        const file = canonicalizeProjectFilePath(r.metadata.file as string)
        const startLine = r.metadata.startLine as number
        const endLine = r.metadata.endLine as number
        return rgMatches.some((m) => m.file === file && m.line >= startLine && m.line <= endLine)
      })
      metrics.patternFilterMs = Date.now() - patternFilterStartedAt
    }

    let patternFallbackResults: WorkingResult[] = []
    if (params.pattern) {
      const patternFallbackStartedAt = Date.now()
      const patternResults = await collectRipgrepFallbackResults(
        params.pattern,
        lexicalCandidateFiles,
        collection,
        filters,
        { semanticScore: 1.04 },
      )
      patternFallbackResults = patternResults.map((result) => ({
        file: result.file,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
        semanticScore: result.semanticScore,
        metadata: result.metadata,
      }))
      metrics.patternFallbackMs = Date.now() - patternFallbackStartedAt
    }

    // Convert to working format with semantic score
    type WorkingResult = {
      file: string
      content: string
      startLine: number
      endLine: number
      semanticScore: number
      rawDistance?: number
      distanceMetric?: VectorStore.DistanceMetric
      metadata: Record<string, string | number | boolean | string[] | undefined>
      rerankScore?: number
      confidence?: "high" | "medium" | "low"
      isWeakMatch?: boolean
      whyMatched?: string[]
      filterMatches?: Record<string, unknown>
    }
    let workingResults: WorkingResult[] = filteredResults.map((r) => ({
      file: r.metadata.file as string,
      content: r.content,
      startLine: r.metadata.startLine as number,
      endLine: r.metadata.endLine as number,
      semanticScore: VectorStore.distanceToSimilarity(r.distance, VectorStore.getDistanceMetric(meta)),
      rawDistance: r.distance,
      distanceMetric: VectorStore.getDistanceMetric(meta),
      metadata: r.metadata,
      whyMatched: ["semantic similarity"],
    }))

    const fallbackResults = [...exactSymbolResults, ...literalFallbackResults, ...patternFallbackResults]
    if (fallbackResults.length > 0) {
      const merged = new Map<string, WorkingResult>()

      for (const result of workingResults) {
        const key = `${result.file}:${result.startLine}:${result.endLine}`
        merged.set(key, result)
      }

      for (const result of fallbackResults) {
        const key = `${result.file}:${result.startLine}:${result.endLine}`
        const existing = merged.get(key)
        if (existing) {
          merged.set(key, {
            ...existing,
            semanticScore: Math.max(existing.semanticScore, result.semanticScore),
            whyMatched: [...new Set([...(existing.whyMatched ?? []), ...(result.whyMatched ?? [])])],
          })
        } else {
          merged.set(key, result)
        }
      }

      workingResults = [...merged.values()]
    }

    workingResults = annotateWorkingResults(workingResults, {
      ...(params as any),
      symbol: symbolQuery ?? exactSymbolQuery,
    })

    // Sort by semantic score initially
    workingResults.sort((a, b) => b.semanticScore - a.semanticScore)

    // Optional rerank (cross-encoder) on top-N candidates
    let rankedResults = workingResults
    if (shouldRerank && workingResults.length > 1) {
      log.warn("rerank requested but reranking is disabled in remote-only mode")
    }

    const minScore = typeof params.minScore === "number" ? params.minScore : undefined
    if (minScore !== undefined) {
      rankedResults = rankedResults.filter((r) => (r.rerankScore ?? r.semanticScore) >= minScore)
    }

    // Dedupe overlapping results within the same file (class vs method, etc.)
    const dedupedResults = dedupeOverlapping(rankedResults)

    // Enforce diversity across file/symbol to avoid repeating the same source
    const maxPerFile = typeof params.maxPerFile === "number" ? Math.max(0, params.maxPerFile) : 2
    const maxPerSymbol = typeof params.maxPerSymbol === "number" ? Math.max(0, params.maxPerSymbol) : 2
    const diversifiedResults = diversifyResults(dedupedResults, { maxPerFile, maxPerSymbol })

    // Take top results
    const finalResults = diversifiedResults.slice(0, limit)

    if (finalResults.length === 0) {
      metrics.totalMs = Date.now() - startedAt
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, freshness, warnings, metrics },
        freshness,
        warnings,
        metrics,
        results: [],
        output: prependFreshnessWarning("No matching results found for your query.", freshness),
      }
    }

    // Apply semantic tree-shaking if enabled (default: true)
    const shouldShake = params.shake !== false && !useLexicalOnly
    
    if (shouldShake) {
      const shakeStartedAt = Date.now()
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
      metrics.treeShakeMs = Date.now() - shakeStartedAt
      metrics.totalMs = Date.now() - startedAt

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
          const kindInfo = typeof meta.semanticKind === "string" && meta.semanticKind ? ` (${meta.semanticKind})` : ""
          if (symbolInfo) metaParts.push(`${symbolInfo}${kindInfo}`)
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
          freshness,
          warnings,
          metrics,
        },
        freshness,
        warnings,
        metrics,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
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
      if (result.confidence) {
        metaParts.push(`Confidence: ${result.confidence}`)
      }
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
      if (meta.semanticKind && typeof meta.semanticKind === "string") {
        metaParts.push(`Kind: ${meta.semanticKind}`)
      }
      if ((params as any).explainFilters && result.whyMatched?.length) {
        metaParts.push(`Why: ${result.whyMatched.join("; ")}`)
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

      metrics.totalMs = Date.now() - startedAt
      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          indexed: true,
          freshness,
          warnings,
          metrics,
        },
        freshness,
        warnings,
        metrics,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Use withConfig to match index embeddings and ensure proper cleanup
    return Embeddings.withConfig(indexConfig as any, () =>
      Instance.provide({
        directory: resolved.root,
        fn: run,
      }),
    )
  },
})
