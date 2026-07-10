import z from "zod"
import { Tool } from "./tool.js"
import { SenseGrepTool } from "./sensegrep.js"
import { SenseGrepParametersSchema } from "./search-schema.js"
import { GitScope } from "../project/git.js"
import { Instance } from "../project/instance.js"

export const SenseGrepContextParametersSchema = SenseGrepParametersSchema.extend({
  maxTokens: z.number().int().positive().max(1_000_000).default(12_000),
  limit: z.number().int().positive().max(500).default(50),
  rerank: z.boolean().default(true),
  requireCoverage: z.boolean().default(false).describe("Report failure when changed files are not represented"),
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
    const coverageSatisfied = !params.requireCoverage || coverage?.exhaustive !== false
    const coverageWarning = coverage && !coverage.exhaustive
      ? `Changed-file coverage: ${coverage.representedFiles}/${coverage.changedFiles}; ${coverage.uncoveredFiles.length} files were not represented.`
      : undefined
    return {
      ...result,
      title: `Context: ${params.query}`,
      metadata: {
        ...result.metadata,
        maxTokens: params.maxTokens,
        ...(coverage ? { coverage, coverageSatisfied } : {}),
      },
      ...(coverage ? { coverage, coverageSatisfied } : {}),
      output: coverageWarning ? `${result.output}\n\n${coverageWarning}` : result.output,
    }
  },
})
