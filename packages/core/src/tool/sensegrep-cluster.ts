import z from "zod"
import { Tool } from "./tool.js"
import { CommonSearchShape } from "./search-schema.js"
import {
  type CommonSensegrepParams,
  type SearchResources,
  type WorkingResult,
  cosineSimilarity,
  deriveDomainLabel,
  formatGroupedResultHeader,
  formatRepresentativeSnippets,
  getDominantSymbolPhrases,
  getGroupingReasons,
  getImportHints,
  getQueryTokens,
  getSymbolTokens,
  hydrateResultsWithVectors,
  jaccardSimilarity,
  metadataSimilarity,
  pathSimilarity,
  runGroupedSearch,
  selectRepresentatives,
  topCounts,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"

const DESCRIPTION = [
  "Semantic code clustering using embeddings + AST metadata + optional literal fallback.",
  "Decomposes a broad query into coherent subthemes and returns representative tree-shaken snippets for each cluster.",
  "Useful when a linear top-N search list is still too noisy for large codebases or broad domain queries.",
].join("\n")

const commonSearchShape = {
  ...CommonSearchShape,
  query: z.string().trim().min(1).describe("Natural language query to cluster into subthemes"),
  shake: z.boolean().default(true).describe("Enable tree-shaken representative snippets"),
} as const

export const ClusterParametersSchema = z.object({
  ...commonSearchShape,
  limit: z.number().int().positive().max(100).optional().describe("Maximum number of clusters to return (default: 5)"),
  rawLimit: z.number().int().positive().max(2000).optional().describe("Maximum raw matches to retrieve before clustering (default: 70)"),
  perCluster: z.number().int().positive().max(20).optional().describe("Representative snippets per cluster (default: 2)"),
  clusterThreshold: z.number().min(0).max(1).optional().describe("Similarity threshold for linking matches into a cluster (default: 0.72)"),
  minClusterSize: z.number().int().positive().optional().describe("Minimum cluster size to keep before singleton fallback (default: 2)"),
})

type ClusterParams = z.infer<typeof ClusterParametersSchema>

type ClusterNode = WorkingResult & {
  importHints: string[]
  symbolHints: string[]
  domainLabel: string
}

type ClusterGroup = {
  title: string
  members: ClusterNode[]
  score: number
  files: Set<string>
  importHints: string[]
  symbolHints: string[]
  domainHints: string[]
  dominantSymbolTypes: string[]
}

const GENERIC_TITLE_SIGNALS = new Set(["api", "client", "clients", "service", "services", "types", "contracts", "model", "models"])

class UnionFind {
  private parent = new Map<number, number>()

  constructor(size: number) {
    for (let index = 0; index < size; index += 1) {
      this.parent.set(index, index)
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value)
    if (parent === undefined || parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }

  union(a: number, b: number) {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA)
    }
  }
}

function combinedSimilarity(a: ClusterNode, b: ClusterNode): number {
  const weighted: Array<[number, number]> = []

  const vectorScore = cosineSimilarity(a.vector, b.vector)
  if (vectorScore > 0) weighted.push([0.6, vectorScore])

  const pathScore = pathSimilarity(a.file, b.file)
  weighted.push([0.15, pathScore])

  const importScore = jaccardSimilarity(a.importHints, b.importHints)
  if (a.importHints.length > 0 || b.importHints.length > 0) {
    weighted.push([0.15, importScore])
  }

  const metaScore = metadataSimilarity(a, b)
  weighted.push([0.1, metaScore])

  const totalWeight = weighted.reduce((sum, [weight]) => sum + weight, 0)
  if (totalWeight === 0) return 0
  return weighted.reduce((sum, [weight, score]) => sum + weight * score, 0) / totalWeight
}

function averagePairwiseSimilarity(cluster: ClusterNode[], candidate: ClusterNode): number {
  if (cluster.length === 0) return 0
  let total = 0
  for (const member of cluster) total += combinedSimilarity(member, candidate)
  return total / cluster.length
}

function buildInitialClusters(nodes: ClusterNode[], threshold: number): ClusterNode[][] {
  if (nodes.length === 0) return []
  const unionFind = new UnionFind(nodes.length)

  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      if (combinedSimilarity(nodes[a], nodes[b]) >= threshold) {
        unionFind.union(a, b)
      }
    }
  }

  const groups = new Map<number, ClusterNode[]>()
  for (let index = 0; index < nodes.length; index += 1) {
    const root = unionFind.find(index)
    const cluster = groups.get(root) ?? []
    cluster.push(nodes[index])
    groups.set(root, cluster)
  }

  return [...groups.values()]
}

function attachSmallClusters(
  clusters: ClusterNode[][],
  threshold: number,
  minClusterSize: number,
): ClusterNode[][] {
  if (minClusterSize <= 1) return clusters

  const largeClusters = clusters.filter((cluster) => cluster.length >= minClusterSize).map((cluster) => [...cluster])
  const smallClusters = clusters.filter((cluster) => cluster.length < minClusterSize)

  if (largeClusters.length === 0 || smallClusters.length === 0) return clusters

  const attachThreshold = Math.max(0.55, threshold - 0.08)
  const leftovers: ClusterNode[][] = []

  for (const cluster of smallClusters) {
    if (cluster.length !== 1) {
      leftovers.push(cluster)
      continue
    }

    const [candidate] = cluster
    let bestClusterIndex = -1
    let bestScore = 0

    for (let index = 0; index < largeClusters.length; index += 1) {
      const score = averagePairwiseSimilarity(largeClusters[index], candidate)
      if (score > bestScore) {
        bestScore = score
        bestClusterIndex = index
      }
    }

    if (bestClusterIndex >= 0 && bestScore >= attachThreshold) {
      largeClusters[bestClusterIndex].push(candidate)
    } else {
      leftovers.push(cluster)
    }
  }

  return [...largeClusters, ...leftovers]
}

function chooseClusterTitle(cluster: ClusterNode[], query: string): string {
  const queryTokenSet = new Set(getQueryTokens(query))
  const domainHints = topCounts(cluster.map((member) => member.domainLabel), 2)
  const strongestDomain = domainHints.find((value) => value !== "related code")
  const importHints = topCounts(cluster.flatMap((member) => member.importHints), 2)
  const symbolHints = topCounts(cluster.flatMap((member) => member.symbolHints), 3, queryTokenSet)
  const symbolPhrases = getDominantSymbolPhrases(cluster, query, 2, false)
  const importSignal = importHints.find((hint) => !GENERIC_TITLE_SIGNALS.has(hint)) ?? importHints[0]
  const strongestSignal = importSignal && !GENERIC_TITLE_SIGNALS.has(importSignal)
    ? importSignal
    : symbolPhrases[0] ?? symbolHints[0] ?? importSignal

  if (strongestDomain && !strongestDomain.startsWith("domain /")) {
    if (strongestSignal) return `${strongestDomain} / ${strongestSignal}`
    return strongestDomain
  }

  if (strongestDomain?.startsWith("domain /")) {
    const suffix = strongestDomain.slice("domain / ".length)
    if (strongestSignal) return `${suffix} / ${strongestSignal}`
    return strongestDomain
  }

  if (strongestSignal) return `cluster / ${strongestSignal}`
  return strongestDomain ?? "related code"
}

function summarizeCluster(cluster: ClusterNode[], query: string): ClusterGroup {
  const symbolTypes = cluster
    .map((member) => (typeof member.metadata.symbolType === "string" ? member.metadata.symbolType : ""))
    .filter(Boolean)

  return {
    title: chooseClusterTitle(cluster, query),
    members: [...cluster].sort((a, b) => b.semanticScore - a.semanticScore),
    score: cluster.reduce((sum, member) => sum + member.semanticScore, 0) / Math.max(1, cluster.length),
    files: new Set(cluster.map((member) => member.file)),
    importHints: cluster.flatMap((member) => member.importHints),
    symbolHints: cluster.flatMap((member) => member.symbolHints),
    domainHints: cluster.map((member) => member.domainLabel),
    dominantSymbolTypes: symbolTypes,
  }
}

function getClusterRepresentativeTerms(group: ClusterGroup): string[] {
  return topCounts([...group.importHints, ...group.symbolHints, ...group.domainHints, ...group.dominantSymbolTypes], 8)
}

function getClusterWhyGrouped(group: ClusterGroup): string[] {
  return getGroupingReasons({
    fallback: "embedding/path/metadata similarity",
    imports: group.importHints,
    symbols: group.symbolHints,
    domains: group.domainHints,
    includeSimilarityReason: true,
  })
}

function buildClusterGroups(
  results: WorkingResult[],
  query: string,
  threshold: number,
  minClusterSize: number,
): ClusterGroup[] {
  const queryTokenSet = new Set(getQueryTokens(query))
  const nodes: ClusterNode[] = results.map((result) => ({
    ...result,
    importHints: getImportHints(result.metadata),
    symbolHints: getSymbolTokens(result.metadata).filter((token) => !queryTokenSet.has(token)),
    domainLabel: deriveDomainLabel(result),
  }))

  const initial = buildInitialClusters(nodes, threshold)
  const normalized = attachSmallClusters(initial, threshold, minClusterSize)
  const groups = normalized.map((cluster) => summarizeCluster(cluster, query))

  return groups.sort((a, b) => {
    const rankA = a.score * Math.log2(a.members.length + 1)
    const rankB = b.score * Math.log2(b.members.length + 1)
    if (rankB !== rankA) return rankB - rankA
    if (b.files.size !== a.files.size) return b.files.size - a.files.size
    return b.members.length - a.members.length
  })
}

async function formatClusterGroup(
  resources: SearchResources,
  cluster: ClusterGroup,
  perCluster: number,
  shake: boolean,
): Promise<string[]> {
  const lines: string[] = []
  const representatives = selectRepresentatives(cluster.members, perCluster)
  const importHints = topCounts(cluster.importHints, 3)
  const symbolHints = topCounts(cluster.symbolHints, 3)
  const symbolTypes = topCounts(cluster.dominantSymbolTypes, 3)
  const domains = topCounts(cluster.domainHints, 2)

  lines.push(...formatGroupedResultHeader({
    title: cluster.title,
    hits: cluster.members.length,
    files: cluster.files.size,
    symbolTypes,
    imports: importHints,
    signals: symbolHints,
    domains,
    whyGrouped: getClusterWhyGrouped(cluster),
  }))

  lines.push(...(await formatRepresentativeSnippets(resources, representatives, { shake })))

  lines.push("")
  return lines
}

async function runCluster(params: ClusterParams, ctx?: Tool.Context) {
  const perCluster = Math.max(1, params.perCluster ?? 2)
  const clusterThreshold = Math.min(0.95, Math.max(0.4, params.clusterThreshold ?? 0.72))
  const minClusterSize = Math.max(1, params.minClusterSize ?? 2)

  return runGroupedSearch({
    params: params as CommonSensegrepParams & ClusterParams,
    heading: "Clusters",
    groupLabel: "clusters",
    resultKey: "clusters",
    signal: ctx?.abort,
    defaultRawLimit: 70,
    rawLimitMultiplier: 8,
    prepareResults: (resources, results) => hydrateResultsWithVectors(resources.collection, results),
    buildGroups: (results) => buildClusterGroups(results as ClusterNode[], params.query, clusterThreshold, minClusterSize),
    formatGroup: (resources, group) => formatClusterGroup(resources, group, perCluster, params.shake !== false),
    metadata: () => ({ clusterThreshold }),
    mapGroup: (group) => ({
        title: group.title,
        score: Number(group.score.toFixed(6)),
        matches: group.members.length,
        files: [...group.files],
        imports: topCounts(group.importHints, 10),
        symbols: topCounts(group.symbolHints, 10),
        domains: topCounts(group.domainHints, 10),
        symbolTypes: topCounts(group.dominantSymbolTypes, 10),
        representativeTerms: getClusterRepresentativeTerms(group),
        whyGrouped: getClusterWhyGrouped(group),
        coverage: {
          files: group.files.size,
          symbols: new Set(group.members.map((member) => member.metadata.symbolName).filter(Boolean)).size,
        },
        results: group.members.map(toStructuredSearchResult),
      }),
  })
}

export const SenseGrepClusterTool = Tool.define("sensegrep-cluster", {
  description: DESCRIPTION,
  parameters: ClusterParametersSchema,
  execute: runCluster,
})
