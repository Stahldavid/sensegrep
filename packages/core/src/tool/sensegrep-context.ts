import z from "zod"
import { Tool } from "./tool.js"
import { SenseGrepTool } from "./sensegrep.js"
import { SenseGrepParametersSchema } from "./search-schema.js"

export const SenseGrepContextParametersSchema = SenseGrepParametersSchema.extend({
  maxTokens: z.number().int().positive().max(1_000_000).default(12_000),
  limit: z.number().int().positive().max(500).default(50),
  rerank: z.boolean().default(true),
})

export const SenseGrepContextTool = Tool.define("sensegrep-context", {
  description: "Build a diversified, tree-shaken code context pack constrained by an estimated token budget.",
  parameters: SenseGrepContextParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    const search = await SenseGrepTool.init()
    const result = await search.execute(params, ctx)
    return {
      ...result,
      title: `Context: ${params.query}`,
      metadata: {
        ...result.metadata,
        maxTokens: params.maxTokens,
      },
    }
  },
})
