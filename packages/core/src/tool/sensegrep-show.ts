import z from "zod"
import { Instance } from "../project/instance.js"
import { CodeGraph } from "../semantic/code-graph.js"
import { Tool } from "./tool.js"
import { decodeResultId } from "./sensegrep-pipeline.js"
import { runShowResult } from "./show-result.js"

export const SenseGrepShowParametersSchema = z.object({
  resultId: z.string().min(1),
  before: z.number().int().nonnegative().max(10_000).default(0),
  after: z.number().int().nonnegative().max(10_000).default(0),
  expand: z.boolean().default(false),
  maxNodes: z.number().int().positive().max(10_000).default(100),
})

export const SenseGrepShowTool = Tool.define("sensegrep-show", {
  description: "Expand a compact Sensegrep result card by its deterministic result ID.",
  parameters: SenseGrepShowParametersSchema,
  async execute(params): Promise<Tool.Result<Record<string, unknown>>> {
    const target = decodeResultId(params.resultId)
    const base = await runShowResult({
      rootDir: Instance.directory,
      resultId: params.resultId,
      before: params.before,
      after: params.after,
    })
    let graph: Record<string, unknown> | undefined
    if (params.expand && target.symbol) {
      const canonicalId = `${target.file}:${target.startLine}:${target.endLine}:${target.symbol}`
      const [references, impact] = await Promise.all([
        CodeGraph.findReferences(target.symbol, { id: canonicalId, limit: params.maxNodes }),
        CodeGraph.impact(target.symbol, { id: canonicalId, limit: params.maxNodes }),
      ])
      graph = { references, impact }
    }
    return {
      ...base,
      command: params.expand ? "expand" : "show",
      ...(graph ? { graph } : {}),
    }
  },
})
