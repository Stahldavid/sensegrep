import { readFileSync } from "node:fs"
import { Tool } from "./tool.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import {
  collectWorkingResults,
  dedupeOverlapping,
  diversifyResults,
  formatFreshnessWarning,
  getFreshnessSummary,
  prependFreshnessWarning,
  reconstructSymbolResults,
  rerankWorkingResults,
  selectWithinTokenBudget,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"
import { SenseGrepParametersSchema } from "./search-schema.js"
import { embeddingConfigFingerprint } from "../semantic/embedding-config.js"

const DESCRIPTION = readFileSync(new URL("./sensegrep.txt", import.meta.url), "utf8")
const MAX_LINE_LENGTH = 2000

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: SenseGrepParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    // Read index metadata first (before any embedding initialization)
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta.embeddings) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "index-required",
        title: params.query,
        metadata: { matches: 0, indexed: false },
        results: [],
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    const meta = resolved.meta
    const schema = typeof VectorStore.inspectCollectionSchema === "function"
      ? await VectorStore.inspectCollectionSchema(resolved.root)
      : { exists: true, tableName: meta.tableName ?? "chunks", schemaCompatible: true, migrationRequired: false, fields: [] as string[], missingFields: [] as string[] }
    const backwardCompatibleMissingFields = new Set(["calls", "fileKind", "fileRole"])
    const readableLegacySchema = schema.exists && schema.missingFields.every((field) => backwardCompatibleMissingFields.has(field))
    const roleFilterNeedsMigration = schema.missingFields.includes("fileRole") && Boolean(params.includeRole || params.excludeRole)
    if (!schema.schemaCompatible && (!readableLegacySchema || roleFilterNeedsMigration)) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "migration-required",
        title: params.query,
        metadata: { matches: 0, indexed: true, schemaCompatible: false, missingFields: schema.missingFields },
        index: { fresh: null, schemaCompatible: false, snapshotId: `${schema.tableName}:${meta.updatedAt}` },
        results: [],
        warnings: ["Index schema is incompatible and was left unchanged."],
        output: `Index migration required; missing fields: ${schema.missingFields.join(", ")}. Run \`sensegrep index --full --no-watch\`.`,
      }
    }

    // Configure embeddings to match the index
    const indexConfig = {
      provider: meta.embeddings.provider,
      embedModel: meta.embeddings.model,
      embedDim: meta.embeddings.dimension,
    }

    const run = async () => {
    if (
      meta.embeddings.configFingerprint &&
      meta.embeddings.configFingerprint !== embeddingConfigFingerprint(Embeddings.getConfig())
    ) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "incompatible-embedding-config",
        title: params.query,
        metadata: { matches: 0, indexed: true, incompatibleEmbeddingConfig: true },
        results: [],
        output: "Embedding endpoint/configuration differs from the indexed vector space. Reindex this profile with `sensegrep index --full --no-watch`, or select the matching profile.",
      }
    }
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
    const collection = schema.schemaCompatible
      ? await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)
      : await VectorStore.openCollectionReadOnly(resolved.root)
    metrics.collectionMs = Date.now() - collectionStartedAt

    const collected = await collectWorkingResults({
      meta,
      collection,
      projectDirectory: resolved.root,
      requestedDirectory: Instance.directory,
      subdirPrefix: resolved.subdirPrefix,
      freshness,
      schema,
    }, params, {
      rawLimit: params.pattern ? limit * 3 : limit * 2,
      diversify: false,
      signal: ctx.abort,
    })
    if ("output" in collected) return collected
    Object.assign(metrics, collected.metrics)
    metrics.embeddingRequests = collected.retrieval.vectorUsed ? 1 : 0
    metrics.estimatedInputTokens = Math.max(1, Math.ceil(params.query.length / 4))
    warnings.push(...collected.warnings)
    const useLexicalOnly = collected.lexicalOnly
    let workingResults = collected.results

    // Sort by semantic score initially
    workingResults.sort((a, b) => b.semanticScore - a.semanticScore)

    // Optional rerank (cross-encoder) on top-N candidates
    let rankedResults = workingResults
    if (shouldRerank && workingResults.length > 1) {
      const rerankStartedAt = Date.now()
      rankedResults = rerankWorkingResults(params.query, workingResults)
      metrics.rerankMs = Date.now() - rerankStartedAt
    }
    rankedResults = await reconstructSymbolResults(resolved.root, rankedResults)

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
    const limitedResults = diversifiedResults.slice(0, limit)
    const budgeted = selectWithinTokenBudget(limitedResults, params.maxTokens)
    const finalResults = budgeted.results
    metrics.estimatedOutputTokens = budgeted.estimatedTokens

    if (finalResults.length === 0) {
      metrics.totalMs = Date.now() - startedAt
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, freshness, warnings, metrics },
        freshness,
        warnings,
        metrics,
        retrieval: collected.retrieval,
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
          retrieval: collected.retrieval,
        },
        freshness,
        warnings,
        metrics,
        retrieval: collected.retrieval,
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
      metaParts.push(`Relevance: ${(Math.max(0, Math.min(1, result.semanticScore)) * 100).toFixed(1)}%`)
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
          retrieval: collected.retrieval,
        },
        freshness,
        warnings,
      metrics,
      retrieval: collected.retrieval,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Use withConfig to match index embeddings and ensure proper cleanup
    const result = await Embeddings.withConfig(indexConfig as any, () =>
      Instance.provide({
        directory: resolved.root,
        fn: run,
      }),
    )
    const freshness = (result as any).freshness
    const metrics = (result as any).metrics ?? {}
    const retrievalTokens = metrics.estimatedInputTokens ?? 0
    const contextTokens = metrics.estimatedOutputTokens ?? 0
    const emittedTokens = Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({
      results: (result as any).results ?? [],
      output: (result as any).output ?? "",
    })) / 4))
    return {
      schemaVersion: 1,
      command: params.commandName ?? "search",
      status: "complete",
      index: {
        fresh: freshness ? !freshness.isStale : null,
        schemaCompatible: schema.schemaCompatible,
        snapshotId: `${meta.tableName ?? "chunks"}:${meta.updatedAt}`,
      },
      ...result,
      budget: {
        tokensRequested: params.maxTokens,
        tokensUsed: contextTokens,
        inputTokens: retrievalTokens,
        retrievalTokens,
        contextTokens,
        emittedTokens,
        embeddingRequests: metrics.embeddingRequests ?? 0,
        embeddingTimeoutMs: params.embeddingTimeoutMs ?? params.latencyBudgetMs,
        elapsedMs: metrics.totalMs ?? 0,
      },
    }
  },
})
