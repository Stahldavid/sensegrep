import { Instance } from "../project/instance.js"
import { VectorStore } from "./lancedb.js"

export namespace CodeGraph {
  export type Location = { file: string; startLine: number; endLine: number; symbol?: string }
  export type Reference = { from: string; to: string; location: Location }
  export type Snapshot = {
    symbols: Map<string, Location[]>
    outgoing: Map<string, Set<string>>
    references: Reference[]
    documents: number
    truncated: boolean
  }

  function identifiers(content: string): Set<string> {
    return new Set(content.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])
  }

  export async function build(options: { maxDocuments?: number } = {}): Promise<Snapshot> {
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta) throw new Error("Semantic index not found. Run `sensegrep index` first.")
    const maxDocuments = Math.max(1, Math.floor(options.maxDocuments ?? 20_000))
    const collection = await VectorStore.getCollectionUnsafe(resolved.root, resolved.meta.embeddings.dimension)
    const rows = await VectorStore.listDocuments(collection, {
      limit: maxDocuments + 1,
      columns: ["id", "content", "file", "startLine", "endLine", "symbolName", "symbolType"],
    })
    const truncated = rows.length > maxDocuments
    const documents = rows.slice(0, maxDocuments)
    const symbols = new Map<string, Location[]>()

    for (const row of documents) {
      const symbol = typeof row.metadata.symbolName === "string" ? row.metadata.symbolName : ""
      if (!symbol) continue
      const locations = symbols.get(symbol) ?? []
      locations.push({
        file: String(row.metadata.file ?? ""),
        startLine: Number(row.metadata.startLine ?? 0),
        endLine: Number(row.metadata.endLine ?? 0),
        symbol,
      })
      symbols.set(symbol, locations)
    }

    const known = new Set(symbols.keys())
    const outgoing = new Map<string, Set<string>>()
    const references: Reference[] = []
    const seenReferences = new Set<string>()
    for (const row of documents) {
      const source = typeof row.metadata.symbolName === "string" && row.metadata.symbolName
        ? row.metadata.symbolName
        : `<file:${String(row.metadata.file ?? "")}>`
      const targets = outgoing.get(source) ?? new Set<string>()
      for (const token of identifiers(row.content)) {
        if (!known.has(token) || token === source) continue
        targets.add(token)
        const location = {
          file: String(row.metadata.file ?? ""),
          startLine: Number(row.metadata.startLine ?? 0),
          endLine: Number(row.metadata.endLine ?? 0),
          ...(source.startsWith("<file:") ? {} : { symbol: source }),
        }
        const key = `${source}\0${token}\0${location.file}\0${location.startLine}`
        if (!seenReferences.has(key)) {
          seenReferences.add(key)
          references.push({ from: source, to: token, location })
        }
      }
      if (targets.size > 0) outgoing.set(source, targets)
    }

    return { symbols, outgoing, references, documents: documents.length, truncated }
  }

  export async function findReferences(symbol: string, options: { limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const limit = Math.max(1, Math.floor(options.limit ?? 100))
    return {
      symbol,
      definitions: graph.symbols.get(symbol) ?? [],
      references: graph.references.filter((reference) => reference.to === symbol).slice(0, limit),
      documents: graph.documents,
      truncated: graph.truncated,
    }
  }

  export async function impact(symbol: string, options: { depth?: number; limit?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 3))
    const limit = Math.max(1, Math.floor(options.limit ?? 200))
    const reverse = new Map<string, Set<string>>()
    for (const [source, targets] of graph.outgoing) {
      for (const target of targets) {
        const incoming = reverse.get(target) ?? new Set<string>()
        incoming.add(source)
        reverse.set(target, incoming)
      }
    }
    const impacted: Array<{ symbol: string; depth: number }> = []
    const seen = new Set([symbol])
    let frontier = [symbol]
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && impacted.length < limit; depth++) {
      const next: string[] = []
      for (const current of frontier) {
        for (const source of reverse.get(current) ?? []) {
          if (seen.has(source)) continue
          seen.add(source)
          impacted.push({ symbol: source, depth })
          next.push(source)
          if (impacted.length >= limit) break
        }
      }
      frontier = next
    }
    return { symbol, impacted, definitions: graph.symbols.get(symbol) ?? [], truncated: graph.truncated }
  }

  export async function trace(from: string, to: string, options: { depth?: number; maxDocuments?: number } = {}) {
    const graph = await build(options)
    const maxDepth = Math.max(1, Math.floor(options.depth ?? 6))
    const queue: string[][] = [[from]]
    const seen = new Set([from])
    while (queue.length > 0) {
      const path = queue.shift()!
      const current = path[path.length - 1]
      if (current === to) return { from, to, found: true, path, truncated: graph.truncated }
      if (path.length - 1 >= maxDepth) continue
      for (const target of graph.outgoing.get(current) ?? []) {
        if (seen.has(target)) continue
        seen.add(target)
        queue.push([...path, target])
      }
    }
    return { from, to, found: false, path: [] as string[], truncated: graph.truncated }
  }
}
