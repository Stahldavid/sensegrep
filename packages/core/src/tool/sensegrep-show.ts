import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Instance } from "../project/instance.js"
import { CodeGraph } from "../semantic/code-graph.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Tool } from "./tool.js"
import { decodeResultId } from "./sensegrep-pipeline.js"

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
    const absolute = path.resolve(Instance.directory, target.file)
    const relative = path.relative(Instance.directory, absolute)
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Result ID points outside the project root.")
    const source = await fs.readFile(absolute, "utf8")
    const lines = source.split(/\r?\n/)
    const startLine = Math.max(1, target.startLine - params.before)
    const endLine = Math.min(lines.length, target.endLine + params.after)
    const content = lines.slice(startLine - 1, endLine).join("\n")
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    const indexedStat = resolved?.meta.files[target.file]
    const currentStat = await fs.stat(absolute)
    const staleLocation = Boolean(indexedStat && (indexedStat.size !== currentStat.size || indexedStat.mtimeMs !== currentStat.mtimeMs))
      || Boolean(target.symbol && !new RegExp(`\\b${target.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content))
    const schema = resolved ? await VectorStore.inspectCollectionSchema(resolved.root) : undefined
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
      schemaVersion: 1,
      command: params.expand ? "expand" : "show",
      status: staleLocation ? "stale-location" : "complete",
      title: `${target.file}:${startLine}-${endLine}`,
      metadata: { resultId: params.resultId, ...target, startLine, endLine, snippetIntegrity: staleLocation ? "stale-location" : "complete" },
      index: resolved ? { fresh: !staleLocation, schemaCompatible: schema?.schemaCompatible ?? false, snapshotId: `${resolved.meta.tableName ?? "chunks"}:${resolved.meta.updatedAt}` } : { fresh: null, schemaCompatible: false },
      warnings: staleLocation ? ["The indexed location is stale; reindex before relying on this expansion."] : [],
      result: { resultId: params.resultId, file: target.file, symbol: target.symbol, startLine, endLine, content, snippetIntegrity: staleLocation ? "stale-location" : "complete" },
      ...(graph ? { graph } : {}),
      output: content,
    }
  },
})
