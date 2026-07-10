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
  resultDetail: z.enum(["compact", "content", "full"]).default("content"),
})

export const SenseGrepContextTool = Tool.define("sensegrep-context", {
  description: "Build a diversified, tree-shaken code context pack constrained by an estimated token budget.",
  parameters: SenseGrepContextParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    const search = await SenseGrepTool.init()
    const result = await search.execute(params, ctx)
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
    const batches: Array<{ id: number; files: string[]; tokens: number; results: Array<Record<string, unknown>> }> = []
    if (params.gitChanged && params.continueUncovered && coverage?.uncoveredFiles.length) {
      let batch = { id: 1, files: [] as string[], tokens: 0, results: [] as Array<Record<string, unknown>> }
      for (const file of coverage.uncoveredFiles) {
        const absolute = path.resolve(Instance.directory, file)
        const relative = path.relative(Instance.directory, absolute)
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue
        const content = await fs.readFile(absolute, "utf8").catch(() => "")
        const maxChars = Math.max(1, params.batchTokens * 4 - file.length - 80)
        let startLine = 1
        for (let offset = 0, part = 0; offset < Math.max(1, content.length); offset += maxChars, part++) {
          const segment = content.slice(offset, offset + maxChars)
          const estimatedTokens = Math.max(1, Math.ceil((segment.length + file.length + 80) / 4))
          if (batch.files.length > 0 && batch.tokens + estimatedTokens > params.batchTokens) {
            batches.push(batch)
            batch = { id: batch.id + 1, files: [], tokens: 0, results: [] }
          }
          const newlineCount = (segment.match(/\n/g) ?? []).length
          const endLine = startLine + newlineCount
          if (!batch.files.includes(file)) batch.files.push(file)
          batch.tokens += estimatedTokens
          batch.results.push({
            resultId: `symbol:${Buffer.from(JSON.stringify({ file, startLine, endLine, part })).toString("base64url")}`,
            file,
            startLine,
            endLine,
            content: segment,
            estimatedTokens,
            snippetIntegrity: "complete",
            evidence: "changed-file-text",
          })
          startLine = endLine + (segment.endsWith("\n") ? 1 : 0)
        }
      }
      if (batch.files.length > 0) batches.push(batch)
    }
    const continuedFiles = new Set(batches.flatMap((batch) => batch.files))
    const textualRepresented = (coverage?.representedFiles ?? 0) + continuedFiles.size
    const finalCoverage = coverage ? {
      ...coverage,
      textual: { representedFiles: textualRepresented, coverage: coverage.changedFiles === 0 ? 1 : textualRepresented / coverage.changedFiles },
      semantic: { representedFiles: coverage.representedFiles, coverage: coverage.coverage },
      graphDependents: { checked: false, representedFiles: 0 },
      exhaustive: textualRepresented >= coverage.changedFiles,
    } : undefined
    const coverageSatisfied = !params.requireCoverage || finalCoverage?.exhaustive !== false
    const coverageWarning = finalCoverage && !finalCoverage.exhaustive
      ? `Changed-file coverage: ${finalCoverage.textual.representedFiles}/${finalCoverage.changedFiles}; ${finalCoverage.changedFiles - finalCoverage.textual.representedFiles} files were not represented.`
      : undefined
    const continuationOutput = batches.length > 0
      ? batches.map((batch) => `\n\n# Audit batch ${batch.id}\n${batch.results.map((entry) => `\n## ${entry.file}\n\`\`\`\n${entry.content}\n\`\`\``).join("\n")}`).join("")
      : ""
    return {
      ...result,
      schemaVersion: 1,
      command: params.commandName ?? "context",
      status: "complete",
      title: `Context: ${params.query}`,
      metadata: {
        ...result.metadata,
        maxTokens: params.maxTokens,
        ...(finalCoverage ? { coverage: finalCoverage, coverageSatisfied } : {}),
      },
      ...(finalCoverage ? { coverage: finalCoverage, coverageSatisfied } : {}),
      ...(batches.length > 0 ? { batches, results: [...((result as any).results ?? []), ...batches.flatMap((batch) => batch.results)] } : {}),
      output: `${coverageWarning ? `${result.output}\n\n${coverageWarning}` : result.output}${continuationOutput}`,
    }
  },
})
