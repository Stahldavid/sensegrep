import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import { VectorStore } from "../semantic/lancedb.js"
import type { SearchResources, WorkingResult } from "./sensegrep-pipeline.js"
import { evidenceTerms } from "./search-quality.js"
import { evidenceKey, type EvidenceRelation } from "./jev-coverage.js"

/** Bounded, one-hop expansion. Only same-file or relative-import calls are resolved. */
export async function expandHelpers(resources: SearchResources, results: WorkingResult[], query: string,
  filters: VectorStore.SearchFilters, allowedFiles: Set<string>, signal?: AbortSignal, jevExpansion = false) {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      expandWithinBudget(resources, results, query, filters, allowedFiles, combined, jevExpansion),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error("Helper expansion exceeded 750ms")) }, 750)
      }),
    ])
  } finally { if (timeout) clearTimeout(timeout) }
}

async function expandWithinBudget(resources: SearchResources, results: WorkingResult[], query: string,
  filters: VectorStore.SearchFilters, allowedFiles: Set<string>, signal?: AbortSignal, jevExpansion = false) {
  const started = Date.now()
  const deadline = started + 750
  const terms = evidenceTerms(query)
  const normalize = (file: string) => file.replace(/\\/g, "/")
  const fileMap = new Map([...allowedFiles].map((file) => [normalize(file), file]))
  let inspectionLimited = results.length > 24
  const edges: Array<{ file: string; symbol: string; source: WorkingResult; relation: EvidenceRelation }> = []
  const sourceByFile = new Map<string,string>()
  const files = new Map<string, WorkingResult[]>()
  for (const result of results.slice(0, 24)) {
    if (!/\.[cm]?[jt]sx?$/.test(result.file)) { inspectionLimited=true; continue }
    if (!files.has(result.file) && files.size >= 6) { inspectionLimited=true; continue }
    files.set(result.file, [...(files.get(result.file) ?? []), result])
  }
  for (const [file, anchors] of files) {
    signal?.throwIfAborted()
    if (Date.now() >= deadline || edges.length >= 32) { inspectionLimited=true; break }
    const absolute = path.resolve(resources.projectDirectory, file)
    const relative = path.relative(resources.projectDirectory, absolute)
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue
    try {
      const stat = await fs.stat(absolute)
      if (stat.size > 512_000) { inspectionLimited=true; continue }
      const source = await fs.readFile(absolute, "utf8")
      const indexedHash = resources.meta?.files?.[file]?.hash
      if (indexedHash && createHash("sha1").update(source).digest("hex") !== indexedHash) { inspectionLimited=true; continue }
      sourceByFile.set(file,source)
      const calls = [...await TreeSitterChunking.graphCalls(source, file),
        ...(jevExpansion ? await TreeSitterChunking.evidenceReferences(source,file) : [])]
      const declared=jevExpansion?new Set(await TreeSitterChunking.evidenceDeclaredSymbols(source,file)):undefined
      for (const call of calls) {
        if (edges.length >= 32) { inspectionLimited=true; break }
        const anchor = anchors.find((r) => call.line >= r.startLine && call.line <= r.endLine)
        if (!anchor || !/^[\w$]+$/.test(call.target)) continue
        if(declared && !call.module && !declared.has(call.target)) continue
        if (!jevExpansion && !evidenceTerms(call.target).some((term) => terms.includes(term))) continue
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
        if (!edges.some((edge) => edge.file === targetFile && edge.symbol === call.target && edge.relation.caller === evidenceKey(anchor) && edge.relation.line === call.line))
          edges.push({ file: targetFile, symbol: call.target, source: anchor, relation: {
            caller: evidenceKey(anchor), file, line: call.line, target: `${targetFile}:${call.target}`,
            kind: 'reference' in call && call.reference ? 'reference' : call.scheduled ? "scheduled-call" : "call", resolved: true,
            callsite: source.split(/\r?\n/).slice(call.line - 1, call.line + 2).join("\n").slice(0, 1200),
            callerSignature: source.split(/\r?\n/).slice(anchor.startLine - 1, anchor.startLine + 2).join("\n").slice(0, 800),
            callerContent: source.split(/\r?\n/).slice(anchor.startLine - 1, anchor.endLine).join("\n").slice(0, 4000),
            callerTruncated: source.split(/\r?\n/).slice(anchor.startLine - 1, anchor.endLine).join("\n").length > 4000,
          } })
      }
    } catch (error) {
      if (signal?.aborted) throw error
      inspectionLimited=true
      // Missing/unparseable sources cannot establish a resolved call.
    }
  }
  if (!edges.length || Date.now() >= deadline) return { results, added: 0, considered: edges.length, elapsedMs: Date.now() - started, truncated: inspectionLimited || Date.now() >= deadline }
  const rows = await VectorStore.listDocuments(resources.collection, {
    filters: { ...filters, all: [...(filters.all ?? []), { key: "file", operator: "in", value: [...new Set(edges.map((e) => e.file))] },
      ...(jevExpansion ? [{ key: "symbolName", operator: "in" as const, value: [...new Set(edges.map(e=>e.symbol))] }] : []),
      ], },
    limit: 256, excludeVector: true, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  })
  signal?.throwIfAborted()
  if (Date.now() >= deadline) return { results, added: 0, considered: edges.length, elapsedMs: Date.now() - started, truncated: true }
  const merged = new Map(results.map((r) => [`${r.file}:${r.startLine}:${r.endLine}`, r]))
  let added = 0
  const targetFreshness = new Map<string, boolean>()
  for (const row of rows) {
    signal?.throwIfAborted()
    if (Date.now() >= deadline) break
    const direct = edges.find((e) => e.file === row.metadata.file && e.symbol === row.metadata.symbolName)
    const relations=[...new Map(edges.filter(e=>e.file===row.metadata.file && e.symbol===row.metadata.symbolName)
      .map(e=>[`${e.relation.caller}:${e.relation.line}:${e.relation.target}`,e.relation])).values()]
    const combineRelations=(previous:EvidenceRelation[]=[])=>[...new Map([...previous,...relations]
      .map(e=>[`${e.caller}:${e.line}:${e.target}`,e])).values()]
    const edge = direct ?? edges.find((e) => e.file === row.metadata.file && e.file !== e.source.file)
    if (!edge) continue
    const targetHash = resources.meta?.files?.[edge.file]?.hash
    if (!targetFreshness.has(edge.file)) {
      try {
        let source=sourceByFile.get(edge.file)
        if(source===undefined) {
          const absolute=path.resolve(resources.projectDirectory,edge.file)
          if((await fs.stat(absolute)).size>512_000) throw Error('Source too large')
          source=await fs.readFile(absolute,'utf8')
        }
        const fresh=!targetHash || createHash('sha1').update(source).digest('hex')===targetHash
        targetFreshness.set(edge.file,fresh)
        if(fresh) sourceByFile.set(edge.file,source)
      } catch { targetFreshness.set(edge.file,false) }
    }
    if (!targetFreshness.get(edge.file)) {inspectionLimited=true;continue}
    const lines=sourceByFile.get(edge.file)!.split(/\r?\n/)
    const startLine=Number(row.metadata.startLine),endLine=Number(row.metadata.endLine)
    if(!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine<1 || endLine<startLine || endLine>lines.length) {inspectionLimited=true;continue}
    // Indexed content includes embedding headers/neighbours. Only verified source
    // lines are admissible as this helper's implementation and token budget.
    const content=lines.slice(startLine-1,endLine).join('\n')
    if(!content.trim()) {inspectionLimited=true;continue}
    const symbol = String(row.metadata.symbolName ?? "")
    const symbolHits = evidenceTerms(symbol).filter((term) => terms.includes(term)).length
    if (!direct && symbolHits < Math.min(2, terms.length)) continue
    const ownTerms = new Set(evidenceTerms(`${symbol} ${content}`))
    const coverage = terms.filter((term) => ownTerms.has(term)).length / Math.max(1, terms.length)
    const symbolCoverage = symbolHits / Math.max(1, terms.length)
    const localSupported = symbolHits >= Math.min(2, terms.length) && coverage >= 0.2 && symbolCoverage > 0
    if (!localSupported && !(jevExpansion && direct)) continue
    const key = `${edge.file}:${row.metadata.startLine}:${row.metadata.endLine}`
    const existing = merged.get(key)
    // Extra graph discovery must not perturb the local candidate ranking on fallback.
    if (existing && !localSupported) {
      if (direct) merged.set(key, { ...existing, evidenceRelations: combineRelations(existing.evidenceRelations) })
      continue
    }
    // A graph relationship alone is not enough: the helper supplies its own query support.
    const score = Math.min(0.95, edge.source.semanticScore * 0.5 + coverage * 0.45 + symbolCoverage * 0.35 + 0.12)
    merged.set(key, { ...existing, jevOnly: existing?.jevOnly ?? (!existing && !localSupported), id: row.id, file: edge.file, content, contentTruncated:false,
      retrievalSources: [...new Set([...(existing?.retrievalSources ?? []), "helper" as const])],
      ...(direct ? { evidenceRelations: combineRelations(existing?.evidenceRelations) } : {}),
      startLine: Number(row.metadata.startLine), endLine: Number(row.metadata.endLine), metadata: row.metadata,
      semanticScore: existing?.semanticScore ?? score,
      rerankScore: Math.max(existing?.rerankScore ?? existing?.semanticScore ?? 0, score),
      whyMatched: [...(existing?.whyMatched ?? []), `helper expansion${direct ? "" : " (related module)"}: ${edge.source.file}:${edge.source.metadata.symbolName ?? edge.source.startLine} -> ${symbol}`],
    })
    if (!existing) added++
  }
  // A known local/imported definition absent from the result is not a completed
  // inspection. Native APIs and callback parameters were excluded above.
  if(jevExpansion && edges.some(edge=>![...merged.values()].some(row=>row.file===edge.file && row.metadata.symbolName===edge.symbol))) inspectionLimited=true
  return { results: [...merged.values()], added, considered: edges.length, elapsedMs: Date.now() - started, truncated: inspectionLimited || Date.now() >= deadline || rows.length === 256 }
}
