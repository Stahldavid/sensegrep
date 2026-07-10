import z from "zod"
import { Tool } from "./tool.js"
import { SenseGrepTool } from "./sensegrep.js"
import { SenseGrepParametersSchema } from "./search-schema.js"
import { GitScope } from "../project/git.js"
import { Instance } from "../project/instance.js"
import fs from "node:fs/promises"
import path from "node:path"

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
  resultDetail: z.enum(["compact", "content", "full"]).default("content"),
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
    const batches: Array<{ id: number; files: string[]; tokens: number; resultIds: string[] }> = []
    const continuationResults: Array<Record<string, unknown>> = []
    const representedRanges = new Set<string>()
    const truncationReasons = new Set<string>()
    let contextTokens = 0
    const baseContextTokens = Number((result as any).budget?.contextTokens ?? (result as any).budget?.tokensUsed ?? 0)
    let evidenceBytes = Buffer.byteLength(JSON.stringify({
      results: (result as any).results ?? [],
      output: (result as any).output ?? "",
    })) + 512
    if (evidenceBytes > maxEvidenceBytes) truncationReasons.add("base-result-exceeds-output-budget")
    if (params.gitChanged && params.continueUncovered && coverage?.uncoveredFiles.length) {
      let batch = { id: 1, files: [] as string[], tokens: 0, resultIds: [] as string[] }
      for (const file of coverage.uncoveredFiles) {
        const absolute = path.resolve(Instance.directory, file)
        const relative = path.relative(Instance.directory, absolute)
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue
        const content = await fs.readFile(absolute, "utf8").catch(() => "")
        const startLine = 1
        const endLine = Math.max(1, content.split(/\r?\n/).length)
        const rangeKey = `${file}:${startLine}:${endLine}`
        if (representedRanges.has(rangeKey)) continue
        const estimatedTokens = Math.max(1, Math.ceil((content.length + file.length + 80) / 4))
        const resultId = `symbol:${Buffer.from(JSON.stringify({ file, startLine, endLine })).toString("base64url")}`
        const card: Record<string, unknown> = {
          resultId,
          file,
          startLine,
          endLine,
          estimatedTokens,
          snippetIntegrity: "complete",
          evidence: "changed-file-text",
          ...(params.resultDetail === "compact" ? {} : { content }),
        }
        const cardBytes = Buffer.byteLength(JSON.stringify(card)) + Buffer.byteLength(file) + Buffer.byteLength(resultId) + 32
        if (baseContextTokens + contextTokens + estimatedTokens > maxTotalTokens) {
          truncationReasons.add("max-total-tokens")
          break
        }
        if (evidenceBytes + cardBytes > maxEvidenceBytes) {
          truncationReasons.add("global-output-budget")
          break
        }
        if (batch.resultIds.length > 0 && batch.tokens + estimatedTokens > params.batchTokens) {
          if (batches.length >= maxBatches) {
            truncationReasons.add("max-batches")
            break
          }
          batches.push(batch)
          batch = { id: batch.id + 1, files: [], tokens: 0, resultIds: [] }
        }
        if (batches.length >= maxBatches) {
          truncationReasons.add("max-batches")
          break
        }
        representedRanges.add(rangeKey)
        batch.files.push(file)
        batch.tokens += estimatedTokens
        batch.resultIds.push(resultId)
        continuationResults.push(card)
        contextTokens += estimatedTokens
        evidenceBytes += cardBytes
      }
      if (batch.files.length > 0 && batches.length < maxBatches) batches.push(batch)
    }
    const continuedFiles = new Set(batches.flatMap((batch) => batch.files))
    const textualRepresented = (coverage?.representedFiles ?? 0) + continuedFiles.size
    const remainingUncoveredFiles = coverage?.uncoveredFiles.filter((file) => !continuedFiles.has(file)) ?? []
    const finalCoverage = coverage ? {
      ...coverage,
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
      ? params.resultDetail === "compact"
        ? `\n\nAudit continuation: ${batches.length} batches, ${continuedFiles.size} files. Expand selected resultId cards with \`sensegrep show\`.`
        : batches.map((batch) => `\n\n# Audit batch ${batch.id}\n${batch.files.map((file) => {
            const entry = continuationResults.find((candidate) => candidate.file === file)
            return `\n## ${file}\n\`\`\`\n${entry?.content ?? ""}\n\`\`\``
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
