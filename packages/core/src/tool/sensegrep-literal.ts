import { GenerationLeases } from "../semantic/generation-leases.js"
import z from "zod"
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
import { runFilesystemLiteral } from "./filesystem-literal.js"
import { createResultId } from "./result-id.js"
import { readProjectSource } from "../file/source-reader.js"
import { describeIndexIdentity } from "../semantic/index-identity.js"

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
  description: "Exact-text verification for a known string or regex, exhaustive occurrence checks, and refinement after semantic discovery. Do not use for concepts, behavior, or initial codebase exploration; start with semantic search.",
  parameters: SenseGrepLiteralParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    if (params.filesystem) {
      return runFilesystemLiteral({
        rootDir: Instance.directory,
        query: params.query,
        regex: params.regex,
        caseSensitive: params.caseSensitive,
        include: params.include,
        exclude: params.exclude,
        limit: params.limit,
        maxOutputBytes: params.maxOutputBytes,
        signal: ctx.abort,
      })
    }
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta && !params.filesystem) {
      return {
        schemaVersion: 1,
        command: "literal",
        status: "index-required",
        title: params.query,
        metadata: { indexed: false, totalMatches: 0, returnedMatches: 0, exhaustive: true },
        matches: [],
        output: "Semantic index not found. Run `sensegrep index` before using indexed literal search.",
      }
    }

    return Instance.provide({ directory: resolved!.root, profile: Instance.profile, fn: async () => {
    const releaseGeneration = resolved ? await new GenerationLeases(VectorStore.getIndexStoragePath(resolved.root), resolved.meta.tableName ?? "chunks").acquire(ctx.abort) : undefined
    try {
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
    const schema = resolved ? await VectorStore.inspectCollectionSchema(resolved.root, resolved.meta.tableName ?? "chunks") : undefined
    const staleIndexedFiles = new Set<string>()
    const unverifiedIndexedFiles = new Set<string>()
    const matchesByFile = new Map<string, typeof rawMatches>()
    for (const match of rawMatches) {
      const file = canonicalizeProjectFilePath(match.file)
      const entries = matchesByFile.get(file) ?? []
      entries.push(match)
      matchesByFile.set(file, entries)
    }
    if (resolved) {
      for (let offset = 0; offset < files.length; offset += 16) {
      ctx.abort.throwIfAborted()
      await Promise.all(files.slice(offset, offset + 16).map(async (file) => {
        const indexed = resolved.meta.files[file]
        if (!indexed) return
        if (indexed.sourceHashKind !== "sha256-raw-v1" || !indexed.sourceSha256) {
          unverifiedIndexedFiles.add(file)
          return
        }
        try {
          const current = await readProjectSource(resolved.root, file, { signal: ctx.abort })
          if (current.rawSha256 !== indexed.sourceSha256 || (matchesByFile.get(file) ?? []).some(match => current.lines[match.line - 1] !== match.text)) staleIndexedFiles.add(file)
        } catch {
          ctx.abort.throwIfAborted()
          staleIndexedFiles.add(file)
        }
      }))
      }
    }
    const collection = resolved && schema?.exists
      ? await VectorStore.openCollectionReadOnly(resolved.root, resolved.meta.tableName ?? "chunks")
      : undefined
    const documentsByFile = new Map<string, Awaited<ReturnType<typeof VectorStore.listDocuments>>>()
    const matches: Array<Record<string, unknown>> = []

    for (const match of selectedMatches) {
      const file = canonicalizeProjectFilePath(match.file)
      let documents = documentsByFile.get(file)
      if (!documents && collection && !staleIndexedFiles.has(file) && !unverifiedIndexedFiles.has(file)) {
        documents = await VectorStore.listDocuments(collection, {
          filters: { all: [{ key: "file", operator: "equals", value: file }] },
          columns: ["id", "file", "startLine", "endLine", "symbolName", "symbolType", "semanticKind"],
        })
        documentsByFile.set(file, documents)
      }
      const document = staleIndexedFiles.has(file) || unverifiedIndexedFiles.has(file) ? undefined : pickBestLiteralDocument(documents ?? [], match.line)
      matches.push({
        file,
        line: match.line,
        text: match.text,
        ...(document ? {
          resultId: createResultId({
            file,
            startLine: Number(document.metadata.startLine),
            endLine: Number(document.metadata.endLine),
            symbol: typeof document.metadata.symbolName === "string" ? document.metadata.symbolName : undefined,
          }),
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
      index: resolved ? { ...describeIndexIdentity(resolved.root, Instance.profile, resolved.meta), fresh: staleIndexedFiles.size > 0 ? false : unverifiedIndexedFiles.size > 0 ? null : true, schemaCompatible: schema?.schemaCompatible ?? false } : { fresh: null, schemaCompatible: false },
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
          unverifiedIndexedFiles: unverifiedIndexedFiles.size,
          unindexedVisibleFiles: params.filesystem ? filesystemFiles.filter((file) => !indexedFiles.includes(file)).length : undefined,
        },
      },
      warnings: [...(staleIndexedFiles.size > 0 ? [`Skipped indexed symbol mapping for ${staleIndexedFiles.size} stale files.`] : []), ...(unverifiedIndexedFiles.size > 0 ? [`Skipped indexed symbol mapping for ${unverifiedIndexedFiles.size} files without verifiable source hashes.`] : [])],
      budget: { maxOutputBytes: params.maxOutputBytes, outputBytes },
      matches,
      output: matches.length > 0
        ? matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n")
        : "No literal matches found.",
    }
    } finally { await releaseGeneration?.() }
    } })
  },
})
