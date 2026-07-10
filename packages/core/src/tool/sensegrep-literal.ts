import z from "zod"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../project/instance.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Tool } from "./tool.js"
import { Ripgrep } from "../file/ripgrep.js"
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
  filesystem: z.boolean().default(false).describe("Search all ripgrep-visible filesystem files instead of the index universe"),
  maxOutputBytes: z.number().int().positive().max(100_000_000).optional().describe("Maximum bytes returned in matches"),
  resultDetail: z.enum(["minimal", "compact", "diagnostic", "full"]).default("minimal"),
})

export const SenseGrepLiteralTool = Tool.define("sensegrep-literal", {
  description: "Exhaustive deterministic code search backed by ripgrep, with optional indexed symbol mapping.",
  parameters: SenseGrepLiteralParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta && !params.filesystem) {
      return {
        title: params.query,
        metadata: { indexed: false, totalMatches: 0, returnedMatches: 0, exhaustive: true },
        matches: [],
        output: "Semantic index not found. Run `sensegrep index` before using indexed literal search.",
      }
    }

    const includeMatcher = params.include ? createGlobMatcher(params.include) : undefined
    const excludeMatcher = params.exclude ? createGlobMatcher(params.exclude) : undefined
    const indexedFiles = Object.keys(resolved?.meta.files ?? {})
    const filesystemFiles: string[] = []
    if (params.filesystem) {
      for await (const file of Ripgrep.files({ cwd: Instance.directory, signal: ctx.abort })) filesystemFiles.push(canonicalizeProjectFilePath(file))
    }
    const universeFiles = params.filesystem ? filesystemFiles : indexedFiles
    const files = universeFiles.filter((file) => {
      if (resolved && getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
      if (!matchesScopedGlob(file, includeMatcher, resolved?.subdirPrefix)) return false
      return !excludeMatcher || !matchesScopedGlob(file, excludeMatcher, resolved?.subdirPrefix)
    })
    const rawMatches = await runRipgrepOnFiles(params.query, files, {
      signal: ctx.abort,
      caseSensitive: params.caseSensitive,
      fixedStrings: !params.regex,
    })
    const limitSelected = params.limit ? rawMatches.slice(0, params.limit) : rawMatches
    const selectedMatches = params.maxOutputBytes
      ? limitSelected.reduce<typeof limitSelected>((selected, match) => {
          const used = selected.reduce((sum, item) => sum + Buffer.byteLength(`${item.file}:${item.line}:${item.text}\n`), 0)
          return used + Buffer.byteLength(`${match.file}:${match.line}:${match.text}\n`) <= params.maxOutputBytes! ? [...selected, match] : selected
        }, [])
      : limitSelected
    const schema = resolved ? await VectorStore.inspectCollectionSchema(resolved.root) : undefined
    const staleIndexedFiles = new Set<string>()
    if (resolved) {
      await Promise.all(files.map(async (file) => {
        const indexed = resolved.meta.files[file]
        if (!indexed) return
        const current = await fs.stat(path.join(resolved.root, file)).catch(() => null)
        if (!current || current.size !== indexed.size || current.mtimeMs !== indexed.mtimeMs) staleIndexedFiles.add(file)
      }))
    }
    const collection = resolved && schema?.exists
      ? await VectorStore.openCollectionReadOnly(resolved.root)
      : undefined
    const documentsByFile = new Map<string, Awaited<ReturnType<typeof VectorStore.listDocuments>>>()
    const matches: Array<Record<string, unknown>> = []

    for (const match of selectedMatches) {
      const file = canonicalizeProjectFilePath(match.file)
      let documents = documentsByFile.get(file)
      if (!documents && collection && !staleIndexedFiles.has(file)) {
        documents = await VectorStore.listDocuments(collection, {
          filters: { all: [{ key: "file", operator: "equals", value: file }] },
          columns: ["id", "file", "startLine", "endLine", "symbolName", "symbolType", "semanticKind"],
        })
        documentsByFile.set(file, documents)
      }
      const document = staleIndexedFiles.has(file) ? undefined : pickBestLiteralDocument(documents ?? [], match.line)
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
    const outputBytes = matches.reduce((sum, match) => sum + Buffer.byteLength(`${match.file}:${match.line}:${match.text}\n`), 0)
    return {
      schemaVersion: 1,
      command: "literal",
      status: "complete",
      title: params.query,
      metadata: {
        indexed: Boolean(resolved),
        totalMatches: rawMatches.length,
        returnedMatches: matches.length,
        exhaustive: !truncated,
        truncated,
        files: new Set(rawMatches.map((match) => match.file)).size,
        outputBytes,
      },
      index: resolved ? { fresh: staleIndexedFiles.size === 0, schemaCompatible: schema?.schemaCompatible ?? false, snapshotId: `${resolved.meta.tableName ?? "chunks"}:${resolved.meta.updatedAt}` } : { fresh: null, schemaCompatible: false },
      retrieval: {
        requestedMode: "literal",
        actualMode: "literal",
        vectorUsed: false,
        exhaustive: !truncated,
        exhaustiveWithin: params.filesystem ? "ripgrep-visible-filesystem" : "indexed-files",
        universe: {
          indexedFiles: indexedFiles.length,
          searchedFiles: files.length,
          excludedFiles: Math.max(0, universeFiles.length - files.length),
          filesystemFiles: params.filesystem ? filesystemFiles.length : undefined,
          staleIndexedFiles: staleIndexedFiles.size,
          unindexedVisibleFiles: params.filesystem ? filesystemFiles.filter((file) => !indexedFiles.includes(file)).length : undefined,
        },
      },
      warnings: staleIndexedFiles.size > 0 ? [`Skipped indexed symbol mapping for ${staleIndexedFiles.size} stale files.`] : [],
      budget: { maxOutputBytes: params.maxOutputBytes, outputBytes },
      matches,
      output: matches.length > 0
        ? matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n")
        : "No literal matches found.",
    }
  },
})
