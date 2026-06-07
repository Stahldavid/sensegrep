import z from "zod"
import { Tool } from "./tool.js"
import {
  type CommonSensegrepParams,
  type SearchResources,
  type WorkingResult,
  collectWorkingResults,
  cosineSimilarity,
  deriveDomainLabel,
  formatCodeFence,
  getImportHints,
  getQueryTokens,
  getSymbolTokens,
  hydrateResultsWithVectors,
  jaccardSimilarity,
  metadataSimilarity,
  pathSimilarity,
  selectRepresentatives,
  shakeRepresentativeResults,
  topCounts,
  toStructuredSearchResult,
  withIndexedSearchResources,
} from "./sensegrep-pipeline.js"

const DESCRIPTION = [
  "Semantic code clustering using embeddings + AST metadata + optional literal fallback.",
  "Decomposes a broad query into coherent subthemes and returns representative tree-shaken snippets for each cluster.",
  "Useful when a linear top-N search list is still too noisy for large codebases or broad domain queries.",
].join("\n")

const commonSearchShape = {
  query: z.string().describe("Natural language query to cluster into subthemes"),
  pattern: z.string().optional().describe("Optional regex pattern to refine results"),
  include: z.string().optional().describe("File glob include filter"),
  exclude: z.string().optional().describe("File glob exclude filter"),
  minScore: z.number().optional().describe("Minimum relevance score 0-1"),
  symbol: z.string().optional().describe("Filter by symbol name"),
  name: z.string().optional().describe('Alias for "symbol"'),
  symbolType: z
    .enum(["function", "class", "method", "type", "variable", "enum", "module"])
    .optional()
    .describe("Filter by semantic symbol type"),
  variant: z.string().optional().describe("Filter by language-specific variant"),
  decorator: z.string().optional().describe("Filter by decorator"),
  isExported: z.boolean().optional().describe("Only exported/public symbols"),
  isAsync: z.boolean().optional().describe("Only async functions/methods"),
  isStatic: z.boolean().optional().describe("Only static methods"),
  isAbstract: z.boolean().optional().describe("Only abstract classes/methods"),
  minComplexity: z.number().optional().describe("Minimum cyclomatic complexity"),
  maxComplexity: z.number().optional().describe("Maximum cyclomatic complexity"),
  hasDocumentation: z.boolean().optional().describe("Require documentation"),
  language: z.enum(["typescript", "javascript", "python", "java", "vue"]).optional().describe("Filter by language"),
  parentScope: z.string().optional().describe("Filter by parent scope/class"),
  imports: z.string().optional().describe("Filter by imported module name"),
  shake: z.boolean().default(true).describe("Enable tree-shaken representative snippets"),
} as const

const ClusterParametersSchema = z.object({
  ...commonSearchShape,
  limit: z.number().optional().describe("Maximum number of clusters to return (default: 5)"),
  rawLimit: z.number().optional().describe("Maximum raw matches to retrieve before clustering (default: 70)"),
  perCluster: z.number().optional().describe("Representative snippets per cluster (default: 2)"),
  clusterThreshold: z.number().optional().describe("Similarity threshold for linking matches into a cluster (default: 0.72)"),
  minClusterSize: z.number().optional().describe("Minimum cluster size to keep before singleton fallback (default: 2)"),
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
  const strongestSignal = importHints[0] ?? symbolHints[0]

  if (strongestDomain && !strongestDomain.startsWith("domain /")) {
    if (strongestSignal) return `${strongestDomain} / ${strongestSignal}`
    return strongestDomain
  }

  if (strongestDomain?.startsWith("domain /")) {
    const suffix = strongestDomain.slice("domain / ".length)
    if (importHints.length > 0) return `${suffix} / ${importHints[0]}`
    if (symbolHints.length > 0) return `${suffix} / ${symbolHints[0]}`
    return strongestDomain
  }

  if (importHints.length > 0) return `cluster / ${importHints.join(" / ")}`
  if (symbolHints.length > 0) return `cluster / ${symbolHints.join(" / ")}`
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

  lines.push(`## ${cluster.title}`)
  const metaParts = [`Hits: ${cluster.members.length}`, `Files: ${cluster.files.size}`]
  if (domains.length > 0) metaParts.push(`Domains: ${domains.join(", ")}`)
  if (symbolTypes.length > 0) metaParts.push(`Symbols: ${symbolTypes.join(", ")}`)
  if (importHints.length > 0) metaParts.push(`Imports: ${importHints.join(", ")}`)
  if (symbolHints.length > 0) metaParts.push(`Signals: ${symbolHints.join(", ")}`)
  lines.push(metaParts.join(" | "))

  if (shake) {
    const shaked = await shakeRepresentativeResults(resources, representatives)
    for (const fileResult of shaked) {
      const statsInfo =
        fileResult.stats.collapsedRegions > 0
          ? ` (${fileResult.stats.hiddenLines} lines hidden in ${fileResult.stats.collapsedRegions} regions)`
          : ""
      lines.push(`### ${fileResult.file}${statsInfo}`)
      const matchLabels = fileResult.originalResults
        .map((result) => [result.metadata.symbolName, result.metadata.symbolType].filter(Boolean).join(" "))
        .filter(Boolean)
      if (matchLabels.length > 0) lines.push(`Matches: ${matchLabels.join(", ")}`)
      lines.push(...formatCodeFence(fileResult.shakedContent, 100))
    }
  } else {
    for (const representative of representatives) {
      const symbolLabel = [representative.metadata.symbolName, representative.metadata.symbolType].filter(Boolean).join(", ")
      const heading = symbolLabel
        ? `${representative.file}:${representative.startLine} (${symbolLabel})`
        : `${representative.file}:${representative.startLine}-${representative.endLine}`
      lines.push(`### ${heading}`)
      lines.push(...formatCodeFence(representative.content, 40))
    }
  }

  lines.push("")
  return lines
}

async function runCluster(params: ClusterParams) {
  return withIndexedSearchResources(params.query, async (resources) => {
    const limit = params.limit ?? 5
    const rawLimit = Math.max(params.rawLimit ?? 70, limit * 8)
    const perCluster = Math.max(1, params.perCluster ?? 2)
    const clusterThreshold = Math.min(0.95, Math.max(0.4, params.clusterThreshold ?? 0.72))
    const minClusterSize = Math.max(1, params.minClusterSize ?? 2)

    const collected = await collectWorkingResults(resources, params as CommonSensegrepParams, {
      rawLimit,
      diversify: false,
    })

    if ("output" in collected) return collected

    const rawResults = collected.results.slice(0, rawLimit)
    if (rawResults.length === 0) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, clusters: 0 },
        output: "No matching results found for your query.",
      }
    }

    const hydrated = await hydrateResultsWithVectors(resources.collection, rawResults)
    const groups = buildClusterGroups(hydrated, params.query, clusterThreshold, minClusterSize).slice(0, limit)
    const outputLines = [
      `Clusters for: ${params.query}`,
      "",
      `Found ${groups.length} clusters from ${hydrated.length} matches across ${new Set(hydrated.map((result) => result.file)).size} files`,
      "",
    ]

    for (const group of groups) {
      outputLines.push(...(await formatClusterGroup(resources, group, perCluster, params.shake !== false)))
    }

    return {
      title: params.query,
      metadata: {
        indexed: true,
        clusters: groups.length,
        matches: hydrated.length,
        files: new Set(hydrated.map((result) => result.file)).size,
        shaked: params.shake !== false,
        clusterThreshold,
      },
      clusters: groups.map((group) => ({
        title: group.title,
        score: Number(group.score.toFixed(6)),
        matches: group.members.length,
        files: [...group.files],
        imports: topCounts(group.importHints, 10),
        symbols: topCounts(group.symbolHints, 10),
        domains: topCounts(group.domainHints, 10),
        symbolTypes: topCounts(group.dominantSymbolTypes, 10),
        results: group.members.map(toStructuredSearchResult),
      })),
      output: outputLines.join("\n"),
    }
  })
}

export const SenseGrepClusterTool = Tool.define("sensegrep-cluster", {
  description: DESCRIPTION,
  parameters: ClusterParametersSchema,
  execute: runCluster,
})
