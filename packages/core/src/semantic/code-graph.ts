import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../project/instance.js"
import { VectorStore } from "./lancedb.js"

export namespace CodeGraph {
  export type Location = { id: string; file: string; startLine: number; endLine: number; symbol?: string }
  export type Node = { id: string; name: string; location: Location }
  export type Reference = {
    from: string
    to: string
    fromId: string
    toId: string
    kind: "call" | "import" | "inheritance" | "component-usage" | "hook-usage" | "convex-api" | "route-invocation" | "scheduled-function" | "schema-table"
    confidence: "high" | "medium"
    location: Location
    targetLocation: Location
  }
  export type Snapshot = {
    symbols: Map<string, Location[]>
    nodes: Map<string, Node>
    outgoing: Map<string, Set<string>>
    references: Reference[]
    documents: number
    truncated: boolean
    metrics: { resolvedEdges: number; unresolvedEdges: number; ambiguousEdges: number; graphCoverage: number }
  }

  const NON_CALL_IDENTIFIERS = new Set([
    "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "super", "import",
  ])
  let cached: { key: string; snapshot: Snapshot } | undefined
  const CACHE_VERSION = 1

  type PersistedSnapshot = {
    version: number
    key: string
    symbols: Array<[string, Location[]]>
    nodes: Array<[string, Node]>
    outgoing: Array<[string, string[]]>
    references: Reference[]
    documents: number
    truncated: boolean
    metrics: Snapshot["metrics"]
  }

  function hydrateSnapshot(value: PersistedSnapshot): Snapshot {
    return {
      symbols: new Map(value.symbols),
      nodes: new Map(value.nodes),
      outgoing: new Map(value.outgoing.map(([id, targets]) => [id, new Set(targets)])),
      references: value.references,
      documents: value.documents,
      truncated: value.truncated,
      metrics: value.metrics,
    }
  }

  async function readPersistedSnapshot(root: string, key: string): Promise<Snapshot | undefined> {
    const cachePath = path.join(VectorStore.getIndexStoragePath(root), "code-graph-cache.json")
    try {
      const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as PersistedSnapshot
      if (parsed.version !== CACHE_VERSION || parsed.key !== key) return undefined
      return hydrateSnapshot(parsed)
    } catch {
      return undefined
    }
  }

  async function persistSnapshot(root: string, key: string, snapshot: Snapshot): Promise<void> {
    const cachePath = path.join(VectorStore.getIndexStoragePath(root), "code-graph-cache.json")
    const temporaryPath = `${cachePath}.${process.pid}.tmp`
    const serialized: PersistedSnapshot = {
      version: CACHE_VERSION,
      key,
      symbols: [...snapshot.symbols.entries()],
      nodes: [...snapshot.nodes.entries()],
      outgoing: [...snapshot.outgoing.entries()].map(([id, targets]) => [id, [...targets]]),
      references: snapshot.references,
      documents: snapshot.documents,
      truncated: snapshot.truncated,
      metrics: snapshot.metrics,
    }
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(serialized)}\n`, "utf8")
      await fs.rm(cachePath, { force: true })
      await fs.rename(temporaryPath, cachePath)
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    }
  }

  function canonicalNodeId(location: Omit<Location, "id">): string {
    return `${location.file}:${location.startLine}:${location.endLine}:${location.symbol ?? "<file>"}`
  }

  function createLocation(metadata: Record<string, unknown>, symbol?: string): Location {
    const base = {
      file: String(metadata.file ?? ""),
      startLine: Number(metadata.startLine ?? 0),
      endLine: Number(metadata.endLine ?? 0),
      ...(symbol ? { symbol } : {}),
    }
    return { id: canonicalNodeId(base), ...base }
  }

  function extractPersistedCalls(content: string, value: unknown, sourceName: string): string[] {
    if (typeof value === "string" && value.trim()) {
      return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
    }

    const calls = new Set<string>()
    for (const match of content.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = match[1]
      if (name !== sourceName && !NON_CALL_IDENTIFIERS.has(name)) calls.add(name)
    }
    return [...calls]
  }

  function resolveTarget(source: Node, candidates: Node[]): { target?: Node; confidence?: "high" | "medium"; ambiguous: boolean } {
    if (candidates.length === 1) return { target: candidates[0], confidence: "high", ambiguous: false }
    const sameFile = candidates.filter((candidate) => candidate.location.file === source.location.file)
    if (sameFile.length === 1) return { target: sameFile[0], confidence: "medium", ambiguous: false }
    return { ambiguous: candidates.length > 1 }
  }

  function classifyEdge(targetName: string, content: string): Reference["kind"] {
    if (/^(api|internal)\./.test(targetName)) return "convex-api"
    if (/\b(scheduler|runAfter|runAt|cron)\b/.test(content)) return "scheduled-function"
    if (/^(fetch|navigate|redirect|router|push|replace)$/i.test(targetName)) return "route-invocation"
    if (/^use[A-Z0-9_]/.test(targetName)) return "hook-usage"
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(targetName) && /<\s*[A-Z]/.test(content)) return "component-usage"
    return "call"
  }

  export async function build(options: { maxDocuments?: number } = {}): Promise<Snapshot> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) throw new Error("Semantic index not found. Run `sensegrep index` first.")
    const maxDocuments = Math.max(1, Math.floor(options.maxDocuments ?? 20_000))
    const cacheKey = `${resolved.root}\0${resolved.meta.updatedAt}\0${maxDocuments}`
    if (process.env.NODE_ENV !== "test" && cached?.key === cacheKey) return cached.snapshot
    if (process.env.NODE_ENV !== "test") {
      const persisted = await readPersistedSnapshot(resolved.root, cacheKey)
      if (persisted) {
        cached = { key: cacheKey, snapshot: persisted }
        return persisted
      }
    }

    const schema = await VectorStore.inspectCollectionSchema(resolved.root)
    const collection = schema.schemaCompatible
      ? await VectorStore.getCollectionUnsafe(resolved.root, resolved.meta.embeddings.dimension)
      : await VectorStore.openCollectionReadOnly(resolved.root)
    const columns = ["id", "content", "file", "startLine", "endLine", "symbolName", "symbolType", "parentScope"]
    if (schema.fields.includes("calls")) columns.push("calls")
    if (schema.fields.includes("imports")) columns.push("imports")
    const rows = await VectorStore.listDocuments(collection, {
      limit: maxDocuments + 1,
      columns,
    })
    const truncated = rows.length > maxDocuments
    const documents = rows.slice(0, maxDocuments)
    const symbols = new Map<string, Location[]>()
    const nodes = new Map<string, Node>()
    const nodesByName = new Map<string, Node[]>()
    const nodeByDocument = new Map<object, Node>()
    const symbolGroups = new Map<string, typeof documents>()

    for (const row of documents) {
      const symbol = typeof row.metadata.symbolName === "string" ? row.metadata.symbolName : ""
      if (!symbol) continue
      const key = `${String(row.metadata.file ?? "")}\0${String(row.metadata.parentScope ?? "")}\0${symbol}`
      symbolGroups.set(key, [...(symbolGroups.get(key) ?? []), row])
    }

    for (const groupedRows of symbolGroups.values()) {
      groupedRows.sort((left, right) => Number(left.metadata.startLine ?? 0) - Number(right.metadata.startLine ?? 0))
      const clusters: typeof documents[] = []
      for (const row of groupedRows) {
        const current = clusters.at(-1)
        const currentEnd = current ? Math.max(...current.map((entry) => Number(entry.metadata.endLine ?? 0))) : -1
        if (!current || Number(row.metadata.startLine ?? 0) > currentEnd + 1) clusters.push([row])
        else current.push(row)
      }
      for (const cluster of clusters) {
        const first = cluster[0]
        const symbol = String(first.metadata.symbolName)
        const metadata = {
          ...first.metadata,
          startLine: Math.min(...cluster.map((entry) => Number(entry.metadata.startLine ?? 0))),
          endLine: Math.max(...cluster.map((entry) => Number(entry.metadata.endLine ?? 0))),
        }
        const location = createLocation(metadata, symbol)
        const node = { id: location.id, name: symbol, location }
        nodes.set(node.id, node)
        nodesByName.set(symbol, [...(nodesByName.get(symbol) ?? []), node])
        symbols.set(symbol, [...(symbols.get(symbol) ?? []), location])
        for (const row of cluster) nodeByDocument.set(row, node)
      }
    }

    const outgoing = new Map<string, Set<string>>()
    const references: Reference[] = []
    const seenReferences = new Set<string>()
    let unresolvedEdges = 0
    let ambiguousEdges = 0
    const addReference = (source: Node, target: Node, kind: Reference["kind"], confidence: "high" | "medium") => {
      if (target.id === source.id) return
      const key = `${source.id}\0${target.id}\0${kind}`
      if (seenReferences.has(key)) return
      seenReferences.add(key)
      const targets = outgoing.get(source.id) ?? new Set<string>()
      targets.add(target.id)
      outgoing.set(source.id, targets)
      references.push({
        from: source.name,
        to: target.name,
        fromId: source.id,
        toId: target.id,
        kind,
        confidence,
        location: source.location,
        targetLocation: target.location,
      })
    }
    for (const row of documents) {
      const sourceName = typeof row.metadata.symbolName === "string" ? row.metadata.symbolName : ""
      const source = sourceName
        ? nodeByDocument.get(row)
        : (() => {
            const sourceLocation = createLocation(row.metadata)
            return { id: sourceLocation.id, name: `<file:${sourceLocation.file}>`, location: sourceLocation }
          })()
      if (!source) continue

      for (const targetName of extractPersistedCalls(row.content, row.metadata.calls, sourceName)) {
        const targetCandidates = nodesByName.get(targetName) ?? nodesByName.get(targetName.split(".").at(-1) ?? "") ?? []
        const resolvedTarget = resolveTarget(source, targetCandidates)
        if (!resolvedTarget.target) {
          if (resolvedTarget.ambiguous) ambiguousEdges++
          else unresolvedEdges++
          continue
        }
        addReference(source, resolvedTarget.target, classifyEdge(targetName, row.content), resolvedTarget.confidence!)
      }

      for (const match of row.content.matchAll(/\bextends\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        const target = resolveTarget(source, nodesByName.get(match[1]) ?? [])
        if (target.target) addReference(source, target.target, "inheritance", target.confidence!)
        else if (target.ambiguous) ambiguousEdges++
        else unresolvedEdges++
      }

      const syntheticTargets: Array<{ name: string; kind: "import" | "schema-table" }> = []
      const imports = typeof row.metadata.imports === "string" ? row.metadata.imports.split(",").map((value) => value.trim()).filter(Boolean) : []
      syntheticTargets.push(...imports.map((name) => ({ name: `module:${name}`, kind: "import" as const })))
      for (const match of row.content.matchAll(/\bdb\.(?:query|insert|patch|replace|delete|get)\s*\(\s*["']([^"']+)["']/g)) {
        syntheticTargets.push({ name: `table:${match[1]}`, kind: "schema-table" })
      }
      for (const synthetic of syntheticTargets) {
        const id = synthetic.name
        let target = nodes.get(id)
        if (!target) {
          const location = { id, file: synthetic.name, startLine: 0, endLine: 0, symbol: synthetic.name }
          target = { id, name: synthetic.name, location }
          nodes.set(id, target)
        }
        addReference(source, target, synthetic.kind, "high")
      }
    }

    const totalEdges = references.length + unresolvedEdges + ambiguousEdges
    const metrics = {
      resolvedEdges: references.length,
      unresolvedEdges,
      ambiguousEdges,
      graphCoverage: totalEdges === 0 ? 1 : references.length / totalEdges,
    }
    const snapshot = { symbols, nodes, outgoing, references, documents: documents.length, truncated, metrics }
    if (process.env.NODE_ENV !== "test") {
      cached = { key: cacheKey, snapshot }
      await persistSnapshot(resolved.root, cacheKey, snapshot)
    }
    return snapshot
  }

  function selectDefinitions(graph: Snapshot, symbol: string, id?: string): Location[] {
    if (!id) return graph.symbols.get(symbol) ?? []
    const node = graph.nodes.get(id)
    if (node) return [node.location]
    const suffix = `:${symbol}`
    const withoutSymbol = id.endsWith(suffix) ? id.slice(0, -suffix.length) : id
    const rangeMatch = withoutSymbol.match(/^(.*):(\d+):(\d+)$/)
    if (!rangeMatch) return []
    const [, file, start, end] = rangeMatch
    return (graph.symbols.get(symbol) ?? []).filter((location) =>
      location.file === file && location.startLine <= Number(end) && location.endLine >= Number(start),
    )
  }

  export async function findReferences(symbol: string, options: { id?: string; limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const limit = Math.max(1, Math.floor(options.limit ?? 100))
    const definitions = selectDefinitions(graph, symbol, options.id)
    const definitionIds = new Set(definitions.map((definition) => definition.id))
    return {
      schemaVersion: 1,
      command: "references",
      status: "complete",
      symbol,
      definitions,
      references: graph.references.filter((reference) => definitionIds.has(reference.toId)).slice(0, limit),
      documents: graph.documents,
      truncated: graph.truncated,
      metrics: graph.metrics,
    }
  }

  export async function impact(symbol: string, options: { id?: string; depth?: number; limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 3))
    const limit = Math.max(1, Math.floor(options.limit ?? 200))
    const definitions = selectDefinitions(graph, symbol, options.id)
    const reverse = new Map<string, Set<string>>()
    for (const [sourceId, targetIds] of graph.outgoing) {
      for (const targetId of targetIds) {
        const incoming = reverse.get(targetId) ?? new Set<string>()
        incoming.add(sourceId)
        reverse.set(targetId, incoming)
      }
    }

    const impacted: Array<{ id: string; symbol: string; depth: number; location: Location }> = []
    const seen = new Set(definitions.map((definition) => definition.id))
    let frontier = [...seen]
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && impacted.length < limit; depth++) {
      const next: string[] = []
      for (const current of frontier) {
        for (const sourceId of reverse.get(current) ?? []) {
          if (seen.has(sourceId)) continue
          const source = graph.nodes.get(sourceId)
          if (!source) continue
          seen.add(sourceId)
          impacted.push({ id: source.id, symbol: source.name, depth, location: source.location })
          next.push(sourceId)
          if (impacted.length >= limit) break
        }
      }
      frontier = next
    }
    return { schemaVersion: 1, command: "impact", status: "complete", symbol, impacted, definitions, truncated: graph.truncated, ambiguous: definitions.length > 1, metrics: graph.metrics }
  }

  export async function trace(from: string, to: string, options: { fromId?: string; toId?: string; depth?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 6))
    const starts = selectDefinitions(graph, from, options.fromId)
    const targets = new Set(selectDefinitions(graph, to, options.toId).map((location) => location.id))
    const queue = starts.map((location) => [location.id])
    const seen = new Set(starts.map((location) => location.id))
    while (queue.length > 0) {
      const ids = queue.shift()!
      const current = ids[ids.length - 1]
      if (targets.has(current)) {
        const pathNodes = ids.map((id) => graph.nodes.get(id)).filter((node): node is Node => Boolean(node))
        return { schemaVersion: 1, command: "trace", status: "complete", from, to, found: true, path: pathNodes.map((node) => node.name), pathNodes, truncated: graph.truncated, metrics: graph.metrics }
      }
      if (ids.length - 1 >= maxDepth) continue
      for (const targetId of graph.outgoing.get(current) ?? []) {
        if (seen.has(targetId)) continue
        seen.add(targetId)
        queue.push([...ids, targetId])
      }
    }
    return { schemaVersion: 1, command: "trace", status: "complete", from, to, found: false, path: [] as string[], pathNodes: [] as Node[], truncated: graph.truncated, metrics: graph.metrics }
  }
}
