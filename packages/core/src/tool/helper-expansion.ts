import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import { VectorStore } from "../semantic/lancedb.js"
import type { SearchResources, WorkingResult } from "./sensegrep-pipeline.js"
import { evidenceTerms } from "./search-quality.js"

/** Bounded, one-hop expansion. Only same-file or relative-import calls are resolved. */
export async function expandHelpers(resources: SearchResources, results: WorkingResult[], query: string,
  filters: VectorStore.SearchFilters, allowedFiles: Set<string>, signal?: AbortSignal) {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      expandWithinBudget(resources, results, query, filters, allowedFiles, combined),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error("Helper expansion exceeded 750ms")) }, 750)
      }),
    ])
  } finally { if (timeout) clearTimeout(timeout) }
}

async function expandWithinBudget(resources: SearchResources, results: WorkingResult[], query: string,
  filters: VectorStore.SearchFilters, allowedFiles: Set<string>, signal?: AbortSignal) {
  const started = Date.now()
  const deadline = started + 750
  const terms = evidenceTerms(query)
  const normalize = (file: string) => file.replace(/\\/g, "/")
  const fileMap = new Map([...allowedFiles].map((file) => [normalize(file), file]))
  const edges: Array<{ file: string; symbol: string; source: WorkingResult }> = []
  const files = new Map<string, WorkingResult[]>()
  for (const result of results.slice(0, 24)) {
    if (!/\.[cm]?[jt]sx?$/.test(result.file)) continue
    if (!files.has(result.file) && files.size >= 6) continue
    files.set(result.file, [...(files.get(result.file) ?? []), result])
  }
  for (const [file, anchors] of files) {
    signal?.throwIfAborted()
    if (Date.now() >= deadline || edges.length >= 32) break
    const absolute = path.resolve(resources.projectDirectory, file)
    const relative = path.relative(resources.projectDirectory, absolute)
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue
    try {
      const stat = await fs.stat(absolute)
      if (stat.size > 512_000) continue
      const source = await fs.readFile(absolute, "utf8")
      const indexedHash = resources.meta?.files?.[file]?.hash
      if (indexedHash && createHash("sha1").update(source).digest("hex") !== indexedHash) continue
      const calls = await TreeSitterChunking.graphCalls(source, file)
      for (const call of calls) {
        if (edges.length >= 32) break
        const anchor = anchors.find((r) => call.line >= r.startLine && call.line <= r.endLine)
        if (!anchor || !/^[\w$]+$/.test(call.target)) continue
        if (!evidenceTerms(call.target).some((term) => terms.includes(term))) continue
        let targetFile = file
        if (call.module) {
          if (!call.module.startsWith(".")) continue
          const base = path.posix.normalize(path.posix.join(path.posix.dirname(normalize(file)), call.module)).replace(/\.[cm]?[jt]sx?$/, "")
          const matches = [...fileMap.keys()].filter((candidate) => {
            const stem = candidate.replace(/\.[cm]?[jt]sx?$/, "")
            return stem === base || stem === `${base}/index`
          })
          if (matches.length !== 1) continue
          targetFile = fileMap.get(matches[0])!
        }
        if (!allowedFiles.has(targetFile)) continue
        if (!edges.some((edge) => edge.file === targetFile && edge.symbol === call.target))
          edges.push({ file: targetFile, symbol: call.target, source: anchor })
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // Missing/unparseable sources cannot establish a resolved call.
    }
  }
  if (!edges.length || Date.now() >= deadline) return { results, added: 0, considered: edges.length, elapsedMs: Date.now() - started, truncated: Date.now() >= deadline }
  const rows = await VectorStore.listDocuments(resources.collection, {
    filters: { ...filters, all: [...(filters.all ?? []), { key: "file", operator: "in", value: [...new Set(edges.map((e) => e.file))] },
      ], },
    limit: 256, excludeVector: true, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  })
  signal?.throwIfAborted()
  if (Date.now() >= deadline) return { results, added: 0, considered: edges.length, elapsedMs: Date.now() - started, truncated: true }
  const merged = new Map(results.map((r) => [`${r.file}:${r.startLine}:${r.endLine}`, r]))
  let added = 0
  for (const row of rows) {
    const direct = edges.find((e) => e.file === row.metadata.file && e.symbol === row.metadata.symbolName)
    const edge = direct ?? edges.find((e) => e.file === row.metadata.file && e.file !== e.source.file)
    if (!edge) continue
    const symbol = String(row.metadata.symbolName ?? "")
    const symbolHits = evidenceTerms(symbol).filter((term) => terms.includes(term)).length
    if (symbolHits < Math.min(2, terms.length)) continue
    const ownTerms = new Set(evidenceTerms(`${symbol} ${row.content}`))
    const coverage = terms.filter((term) => ownTerms.has(term)).length / Math.max(1, terms.length)
    const symbolCoverage = symbolHits / Math.max(1, terms.length)
    if (coverage < 0.2 || symbolCoverage === 0) continue
    const key = `${edge.file}:${row.metadata.startLine}:${row.metadata.endLine}`
    const existing = merged.get(key)
    // A graph relationship alone is not enough: the helper supplies its own query support.
    const score = Math.min(0.95, edge.source.semanticScore * 0.5 + coverage * 0.45 + symbolCoverage * 0.35 + 0.12)
    merged.set(key, { ...existing, id: row.id, file: edge.file, content: row.content,
      startLine: Number(row.metadata.startLine), endLine: Number(row.metadata.endLine), metadata: row.metadata,
      semanticScore: existing?.semanticScore ?? score,
      rerankScore: Math.max(existing?.rerankScore ?? existing?.semanticScore ?? 0, score),
      whyMatched: [...(existing?.whyMatched ?? []), `helper expansion${direct ? "" : " (related module)"}: ${edge.source.file}:${edge.source.metadata.symbolName ?? edge.source.startLine} -> ${symbol}`],
    })
    if (!existing) added++
  }
  return { results: [...merged.values()], added, considered: edges.length, elapsedMs: Date.now() - started, truncated: rows.length === 256 }
}
