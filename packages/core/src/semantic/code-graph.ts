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
    kind: "call"
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
  }

  const NON_CALL_IDENTIFIERS = new Set([
    "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "super", "import",
  ])
  let cached: { key: string; snapshot: Snapshot } | undefined

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

  function resolveTarget(source: Node, candidates: Node[]): { target: Node; confidence: "high" | "medium" } | undefined {
    if (candidates.length === 1) return { target: candidates[0], confidence: "high" }
    const sameFile = candidates.filter((candidate) => candidate.location.file === source.location.file)
    if (sameFile.length === 1) return { target: sameFile[0], confidence: "medium" }
    return undefined
  }

  export async function build(options: { maxDocuments?: number } = {}): Promise<Snapshot> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) throw new Error("Semantic index not found. Run `sensegrep index` first.")
    const maxDocuments = Math.max(1, Math.floor(options.maxDocuments ?? 20_000))
    const cacheKey = `${resolved.root}\0${resolved.meta.updatedAt}\0${maxDocuments}`
    if (process.env.NODE_ENV !== "test" && cached?.key === cacheKey) return cached.snapshot

    const collection = await VectorStore.getCollectionUnsafe(resolved.root, resolved.meta.embeddings.dimension)
    const rows = await VectorStore.listDocuments(collection, {
      limit: maxDocuments + 1,
      columns: ["id", "content", "file", "startLine", "endLine", "symbolName", "symbolType", "calls"],
    })
    const truncated = rows.length > maxDocuments
    const documents = rows.slice(0, maxDocuments)
    const symbols = new Map<string, Location[]>()
    const nodes = new Map<string, Node>()
    const nodesByName = new Map<string, Node[]>()

    for (const row of documents) {
      const symbol = typeof row.metadata.symbolName === "string" ? row.metadata.symbolName : ""
      if (!symbol) continue
      const location = createLocation(row.metadata, symbol)
      const node = { id: location.id, name: symbol, location }
      if (nodes.has(node.id)) continue
      nodes.set(node.id, node)
      const named = nodesByName.get(symbol) ?? []
      named.push(node)
      nodesByName.set(symbol, named)
      const locations = symbols.get(symbol) ?? []
      locations.push(location)
      symbols.set(symbol, locations)
    }

    const outgoing = new Map<string, Set<string>>()
    const references: Reference[] = []
    const seenReferences = new Set<string>()
    for (const row of documents) {
      const sourceName = typeof row.metadata.symbolName === "string" ? row.metadata.symbolName : ""
      const sourceLocation = createLocation(row.metadata, sourceName || undefined)
      const source = sourceName
        ? nodes.get(sourceLocation.id)
        : { id: sourceLocation.id, name: `<file:${sourceLocation.file}>`, location: sourceLocation }
      if (!source) continue

      for (const targetName of extractPersistedCalls(row.content, row.metadata.calls, sourceName)) {
        const resolvedTarget = resolveTarget(source, nodesByName.get(targetName) ?? [])
        if (!resolvedTarget || resolvedTarget.target.id === source.id) continue
        const key = `${source.id}\0${resolvedTarget.target.id}`
        if (seenReferences.has(key)) continue
        seenReferences.add(key)
        const targets = outgoing.get(source.id) ?? new Set<string>()
        targets.add(resolvedTarget.target.id)
        outgoing.set(source.id, targets)
        references.push({
          from: source.name,
          to: resolvedTarget.target.name,
          fromId: source.id,
          toId: resolvedTarget.target.id,
          kind: "call",
          confidence: resolvedTarget.confidence,
          location: source.location,
          targetLocation: resolvedTarget.target.location,
        })
      }
    }

    const snapshot = { symbols, nodes, outgoing, references, documents: documents.length, truncated }
    if (process.env.NODE_ENV !== "test") cached = { key: cacheKey, snapshot }
    return snapshot
  }

  export async function findReferences(symbol: string, options: { limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const limit = Math.max(1, Math.floor(options.limit ?? 100))
    const definitions = graph.symbols.get(symbol) ?? []
    const definitionIds = new Set(definitions.map((definition) => definition.id))
    return {
      symbol,
      definitions,
      references: graph.references.filter((reference) => definitionIds.has(reference.toId)).slice(0, limit),
      documents: graph.documents,
      truncated: graph.truncated,
    }
  }

  export async function impact(symbol: string, options: { depth?: number; limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 3))
    const limit = Math.max(1, Math.floor(options.limit ?? 200))
    const definitions = graph.symbols.get(symbol) ?? []
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
    return { symbol, impacted, definitions, truncated: graph.truncated, ambiguous: definitions.length > 1 }
  }

  export async function trace(from: string, to: string, options: { depth?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 6))
    const starts = graph.symbols.get(from) ?? []
    const targets = new Set((graph.symbols.get(to) ?? []).map((location) => location.id))
    const queue = starts.map((location) => [location.id])
    const seen = new Set(starts.map((location) => location.id))
    while (queue.length > 0) {
      const ids = queue.shift()!
      const current = ids[ids.length - 1]
      if (targets.has(current)) {
        const pathNodes = ids.map((id) => graph.nodes.get(id)).filter((node): node is Node => Boolean(node))
        return { from, to, found: true, path: pathNodes.map((node) => node.name), pathNodes, truncated: graph.truncated }
      }
      if (ids.length - 1 >= maxDepth) continue
      for (const targetId of graph.outgoing.get(current) ?? []) {
        if (seen.has(targetId)) continue
        seen.add(targetId)
        queue.push([...ids, targetId])
      }
    }
    return { from, to, found: false, path: [] as string[], pathNodes: [] as Node[], truncated: graph.truncated }
  }
}
