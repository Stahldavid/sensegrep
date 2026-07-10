import z from "zod"
import { Instance } from "../project/instance.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Tool } from "./tool.js"
import {
  canonicalizeProjectFilePath,
  createGlobMatcher,
  getScopedFilePath,
  matchesScopedGlob,
  pickBestLiteralDocument,
  runRipgrepOnFiles,
} from "./sensegrep-pipeline.js"

export const SenseGrepLiteralParametersSchema = z.object({
  query: z.string().min(1).describe("Literal string or regular expression"),
  regex: z.boolean().default(false).describe("Interpret query as a regular expression"),
  caseSensitive: z.boolean().default(true).describe("Match case exactly"),
  include: z.string().optional().describe("File glob include filter"),
  exclude: z.string().optional().describe("File glob exclude filter"),
  limit: z.number().int().positive().max(1_000_000).optional().describe("Maximum occurrences to return"),
})

export const SenseGrepLiteralTool = Tool.define("sensegrep-literal", {
  description: "Exhaustive deterministic code search backed by ripgrep, with optional indexed symbol mapping.",
  parameters: SenseGrepLiteralParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) {
      return {
        title: params.query,
        metadata: { indexed: false, totalMatches: 0, returnedMatches: 0, exhaustive: true },
        matches: [],
        output: "Semantic index not found. Run `sensegrep index` before using indexed literal search.",
      }
    }

    const includeMatcher = params.include ? createGlobMatcher(params.include) : undefined
    const excludeMatcher = params.exclude ? createGlobMatcher(params.exclude) : undefined
    const files = Object.keys(resolved.meta.files).filter((file) => {
      if (getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
      if (!matchesScopedGlob(file, includeMatcher, resolved.subdirPrefix)) return false
      return !excludeMatcher || !matchesScopedGlob(file, excludeMatcher, resolved.subdirPrefix)
    })
    const rawMatches = await runRipgrepOnFiles(params.query, files, {
      signal: ctx.abort,
      caseSensitive: params.caseSensitive,
      fixedStrings: !params.regex,
    })
    const selectedMatches = params.limit ? rawMatches.slice(0, params.limit) : rawMatches
    const collection = await VectorStore.getCollectionUnsafe(resolved.root, resolved.meta.embeddings.dimension)
    const documentsByFile = new Map<string, Awaited<ReturnType<typeof VectorStore.listDocuments>>>()
    const matches: Array<Record<string, unknown>> = []

    for (const match of selectedMatches) {
      const file = canonicalizeProjectFilePath(match.file)
      let documents = documentsByFile.get(file)
      if (!documents) {
        documents = await VectorStore.listDocuments(collection, {
          filters: { all: [{ key: "file", operator: "equals", value: file }] },
          columns: ["id", "file", "startLine", "endLine", "symbolName", "symbolType", "semanticKind"],
        })
        documentsByFile.set(file, documents)
      }
      const document = pickBestLiteralDocument(documents, match.line)
      matches.push({
        file,
        line: match.line,
        text: match.text,
        ...(document ? {
          chunkStartLine: Number(document.metadata.startLine),
          chunkEndLine: Number(document.metadata.endLine),
          symbolName: document.metadata.symbolName,
          symbolType: document.metadata.symbolType,
          semanticKind: document.metadata.semanticKind,
        } : {}),
      })
    }

    const truncated = selectedMatches.length < rawMatches.length
    return {
      title: params.query,
      metadata: {
        indexed: true,
        totalMatches: rawMatches.length,
        returnedMatches: matches.length,
        exhaustive: !truncated,
        truncated,
        files: new Set(rawMatches.map((match) => match.file)).size,
      },
      matches,
      output: matches.length > 0
        ? matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n")
        : "No literal matches found.",
    }
  },
})
