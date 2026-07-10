import z from "zod"
import { Tool } from "./tool.js"
import { SenseGrepTool } from "./sensegrep.js"
import { SenseGrepParametersSchema } from "./search-schema.js"
import { GitScope } from "../project/git.js"
import { Instance } from "../project/instance.js"
import fs from "node:fs/promises"
import path from "node:path"

type AuditSegment = {
  content: string
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
  estimatedTokens: number
}

function splitAuditContent(file: string, content: string, maxTokens: number): AuditSegment[] {
  const metadataChars = file.length + 80
  const maxContentChars = maxTokens * 4 - metadataChars
  if (maxContentChars <= 0) return []
  if (content.length === 0) {
    return [{ content: "", startLine: 1, endLine: 1, startOffset: 0, endOffset: 0, estimatedTokens: Math.ceil(metadataChars / 4) }]
  }

  const segments: AuditSegment[] = []
  let startOffset = 0
  let startLine = 1
  while (startOffset < content.length) {
    let endOffset = Math.min(content.length, startOffset + maxContentChars)
    if (endOffset < content.length) {
      const newline = content.lastIndexOf("\n", endOffset - 1)
      if (newline >= startOffset) endOffset = newline + 1
    }
    if (endOffset <= startOffset) endOffset = Math.min(content.length, startOffset + maxContentChars)
    const segmentContent = content.slice(startOffset, endOffset)
    const lineBreaks = segmentContent.match(/\n/g)?.length ?? 0
    const endLine = Math.max(startLine, startLine + lineBreaks - (segmentContent.endsWith("\n") ? 1 : 0))
    segments.push({
      content: segmentContent,
      startLine,
      endLine,
      startOffset,
      endOffset,
      estimatedTokens: Math.max(1, Math.ceil((segmentContent.length + metadataChars) / 4)),
    })
    startLine += lineBreaks
    startOffset = endOffset
  }
  return segments
}

function projectResultForBudget(entry: any, detail: "minimal" | "compact" | "content" | "diagnostic" | "full") {
  if (detail !== "compact" && detail !== "minimal") return entry
  return {
    resultId: entry.resultId,
    file: entry.file,
    startLine: entry.startLine,
    endLine: entry.endLine,
    symbolName: entry.symbolName,
    symbolType: entry.symbolType,
    type: entry.type,
    language: entry.language,
    semanticKind: entry.semanticKind,
    score: entry.score,
    rawDistance: entry.rawDistance,
    distanceMetric: entry.distanceMetric,
    estimatedTokens: entry.estimatedTokens,
    chunksMatched: entry.chunksMatched,
    snippetIntegrity: entry.snippetIntegrity,
    fileRole: entry.fileRole ?? entry.metadata?.fileRole,
  }
}

export const SenseGrepContextParametersSchema = SenseGrepParametersSchema.extend({
  maxTokens: z.number().int().positive().max(1_000_000).default(12_000),
  limit: z.number().int().positive().max(500).default(50),
  rerank: z.boolean().default(true),
  requireCoverage: z.boolean().default(false).describe("Report failure when changed files are not represented"),
  continueUncovered: z.boolean().default(false).describe("Append token-bounded textual batches for uncovered changed files"),
  batchTokens: z.number().int().positive().max(1_000_000).default(4_000).describe("Token budget for each uncovered-file batch"),
  maxTotalTokens: z.number().int().positive().max(1_000_000).optional().describe("Global emitted-token budget including continuation batches"),
  maxOutputBytes: z.number().int().positive().max(100_000_000).optional().describe("Global serialized evidence budget"),
  maxBatches: z.number().int().positive().max(10_000).optional().describe("Maximum continuation batches"),
  resultDetail: z.enum(["minimal", "compact", "content", "diagnostic", "full"]).default("content"),
})

export const SenseGrepContextTool = Tool.define("sensegrep-context", {
  description: "Build a diversified, tree-shaken code context pack constrained by an estimated token budget.",
  parameters: SenseGrepContextParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    const search = await SenseGrepTool.init()
    const maxTotalTokens = params.maxTotalTokens ?? params.maxTokens
    const result = await search.execute({
      ...params,
      maxTokens: Math.min(params.maxTokens, maxTotalTokens),
    }, ctx)
    const coverage = params.gitChanged
      ? await GitScope.changedFiles(Instance.directory, { base: params.gitBase, signal: ctx.abort }).then((changedFiles) => {
          const representedFiles = new Set(
            (Array.isArray((result as any).results) ? (result as any).results : [])
              .map((entry: any) => typeof entry?.file === "string" ? entry.file.replace(/\\/g, "/") : "")
              .filter(Boolean),
          )
          const uncoveredFiles = changedFiles.filter((file) => !representedFiles.has(file.replace(/\\/g, "/")))
          return {
            changedFiles: changedFiles.length,
            representedFiles: changedFiles.length - uncoveredFiles.length,
            uncoveredFiles,
            coverage: changedFiles.length === 0 ? 1 : (changedFiles.length - uncoveredFiles.length) / changedFiles.length,
            exhaustive: uncoveredFiles.length === 0,
          }
        })
      : undefined
    const maxOutputBytes = params.maxOutputBytes ?? maxTotalTokens * 4
    const maxBatches = params.maxBatches ?? 50
    const maxEvidenceBytes = Math.min(maxOutputBytes, maxTotalTokens * 4)
    type BatchRange = { resultId: string; file: string; startLine: number; endLine: number; startOffset: number; endOffset: number; estimatedTokens: number }
    const batches: Array<{ id: number; files: string[]; tokens: number; resultIds: string[]; ranges: BatchRange[] }> = []
    const continuationResults: Array<Record<string, unknown>> = []
    const representedRanges = new Set<string>()
    const completedContinuationFiles = new Set<string>()
    const truncationReasons = new Set<string>()
    let contextTokens = 0
    const baseContextTokens = Number((result as any).budget?.contextTokens ?? (result as any).budget?.tokensUsed ?? 0)
    let evidenceBytes = Buffer.byteLength(JSON.stringify({
      results: ((result as any).results ?? []).map((entry: any) => projectResultForBudget(entry, params.resultDetail)),
      ...(params.resultDetail === "full" ? { output: (result as any).output ?? "" } : {}),
    })) + 512
    if (evidenceBytes > maxEvidenceBytes) truncationReasons.add("base-result-exceeds-output-budget")
    if (params.gitChanged && params.continueUncovered && coverage?.uncoveredFiles.length) {
      let batch = { id: 1, files: [] as string[], tokens: 0, resultIds: [] as string[], ranges: [] as BatchRange[] }
      let stopped = false
      for (const file of coverage.uncoveredFiles) {
        const absolute = path.resolve(Instance.directory, file)
        const relative = path.relative(Instance.directory, absolute)
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue
        const content = await fs.readFile(absolute, "utf8").catch(() => "")
        const segments = splitAuditContent(file, content, params.batchTokens)
        if (segments.length === 0) {
          truncationReasons.add("batch-token-budget-too-small")
          break
        }
        let fileComplete = true
        for (const segment of segments) {
          const rangeKey = `${file}:${segment.startOffset}:${segment.endOffset}`
          if (representedRanges.has(rangeKey)) continue
          const resultId = `symbol:${Buffer.from(JSON.stringify({
            file,
            startLine: segment.startLine,
            endLine: segment.endLine,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset,
          })).toString("base64url")}`
          const card: Record<string, unknown> = {
            resultId,
            file,
            startLine: segment.startLine,
            endLine: segment.endLine,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset,
            estimatedTokens: segment.estimatedTokens,
            snippetIntegrity: segments.length === 1 ? "complete" : "partial",
            evidence: "changed-file-text",
            ...(params.resultDetail === "compact" || params.resultDetail === "minimal" ? {} : { content: segment.content }),
          }
          const cardBytes = Buffer.byteLength(JSON.stringify(card)) + Buffer.byteLength(file) + Buffer.byteLength(resultId) + 32
          if (baseContextTokens + contextTokens + segment.estimatedTokens > maxTotalTokens) {
            truncationReasons.add("max-total-tokens")
            fileComplete = false
            stopped = true
            break
          }
          if (evidenceBytes + cardBytes > maxEvidenceBytes) {
            truncationReasons.add("global-output-budget")
            fileComplete = false
            stopped = true
            break
          }
          if (batch.resultIds.length > 0 && batch.tokens + segment.estimatedTokens > params.batchTokens) {
            batches.push(batch)
            if (batches.length >= maxBatches) {
              truncationReasons.add("max-batches")
              fileComplete = false
              stopped = true
              break
            }
            batch = { id: batch.id + 1, files: [], tokens: 0, resultIds: [], ranges: [] }
          }
          representedRanges.add(rangeKey)
          if (!batch.files.includes(file)) batch.files.push(file)
          batch.tokens += segment.estimatedTokens
          batch.resultIds.push(resultId)
          batch.ranges.push({
            resultId,
            file,
            startLine: segment.startLine,
            endLine: segment.endLine,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset,
            estimatedTokens: segment.estimatedTokens,
          })
          continuationResults.push(card)
          contextTokens += segment.estimatedTokens
          evidenceBytes += cardBytes
        }
        if (fileComplete) completedContinuationFiles.add(file)
        if (stopped) break
      }
      if (batch.files.length > 0 && batches.length < maxBatches) batches.push(batch)
    }
    const continuedFiles = completedContinuationFiles
    const textualRepresented = (coverage?.representedFiles ?? 0) + continuedFiles.size
    const remainingUncoveredFiles = coverage?.uncoveredFiles.filter((file) => !continuedFiles.has(file)) ?? []
    const finalCoverage = coverage ? {
      ...coverage,
      semanticRepresentedFiles: coverage.representedFiles,
      uncoveredFiles: remainingUncoveredFiles,
      textual: { representedFiles: textualRepresented, coverage: coverage.changedFiles === 0 ? 1 : textualRepresented / coverage.changedFiles },
      semantic: { representedFiles: coverage.representedFiles, coverage: coverage.coverage },
      graphDependents: { checked: false, representedFiles: 0 },
      exhaustive: textualRepresented >= coverage.changedFiles,
      complete: textualRepresented >= coverage.changedFiles,
      truncated: truncationReasons.size > 0,
      truncationReasons: [...truncationReasons],
    } : undefined
    const coverageSatisfied = !params.requireCoverage || finalCoverage?.exhaustive !== false
    const coverageWarning = finalCoverage && !finalCoverage.exhaustive
      ? `Changed-file coverage: ${finalCoverage.textual.representedFiles}/${finalCoverage.changedFiles}; ${finalCoverage.changedFiles - finalCoverage.textual.representedFiles} files were not represented.`
      : undefined
    const continuationOutput = batches.length > 0
      ? params.resultDetail === "compact" || params.resultDetail === "minimal"
        ? `\n\nAudit continuation: ${batches.length} batches, ${continuedFiles.size} files. Expand selected resultId cards with \`sensegrep show\`.`
        : batches.map((batch) => `\n\n# Audit batch ${batch.id}\n${batch.resultIds.map((resultId) => {
            const entry = continuationResults.find((candidate) => candidate.resultId === resultId)
            return `\n## ${entry?.file}:${entry?.startLine}-${entry?.endLine}\n\`\`\`\n${entry?.content ?? ""}\n\`\`\``
          }).join("\n")}`).join("")
      : ""
    const output = `${coverageWarning ? `${result.output}\n\n${coverageWarning}` : result.output}${continuationOutput}`
    const emittedPayload = {
      batches,
      results: [...((result as any).results ?? []), ...continuationResults],
      coverage: finalCoverage,
      output,
    }
    const outputBytes = Buffer.byteLength(JSON.stringify(emittedPayload))
    const emittedTokens = Math.ceil(outputBytes / 4)
    return {
      ...result,
      schemaVersion: 1,
      command: params.commandName ?? "context",
      status: finalCoverage?.exhaustive === false ? "incomplete" : "complete",
      title: `Context: ${params.query}`,
      metadata: {
        ...result.metadata,
        maxTokens: params.maxTokens,
        ...(finalCoverage ? { coverage: finalCoverage, coverageSatisfied } : {}),
      },
      ...(finalCoverage ? { coverage: finalCoverage, coverageSatisfied } : {}),
      budget: {
        ...((result as any).budget ?? {}),
        retrievalTokens: Number((result as any).budget?.inputTokens ?? 0),
        contextTokens: baseContextTokens + contextTokens,
        attemptedTokens: emittedTokens,
        attemptedOutputBytes: outputBytes,
        emittedTokens,
        outputBytes,
        maxTotalTokens,
        maxOutputBytes,
        maxBatches,
      },
      ...(batches.length > 0 ? { batches, results: [...((result as any).results ?? []), ...continuationResults] } : {}),
      output,
    }
  },
})
