import { beforeEach, describe, expect, it, vi } from "vitest"

const readIndexMeta = vi.fn()
const resolveIndexedProject = vi.fn()
const clearProjectCache = vi.fn()
const getCollectionUnsafe = vi.fn()
const search = vi.fn()
const listDocuments = vi.fn()
const withConfig = vi.fn(async (_config, run: () => Promise<unknown>) => run())
const verifyIndex = vi.fn()
const getDistanceMetric = vi.fn(() => "cosine")
const distanceToSimilarity = vi.fn((distance: number) => 1 - distance)

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    resolveIndexedProject,
    clearProjectCache,
    getCollectionUnsafe,
    search,
    listDocuments,
    getDistanceMetric,
    distanceToSimilarity,
  },
}))

vi.mock("../semantic/embeddings.js", () => ({
  Embeddings: {
    withConfig,
  },
}))

vi.mock("../semantic/indexer.js", () => ({
  Indexer: {
    verifyIndex,
  },
}))

vi.mock("../semantic/tree-shaker.js", () => ({
  TreeShaker: {},
}))

vi.mock("../project/instance.js", () => ({
  Instance: {
    directory: "/repo",
    provide: async (input: { fn: () => unknown }) => input.fn(),
  },
}))

describe("SenseGrepClusterTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "backend-api/src/services/PriceListCommissionService.java": {},
        "backend-api/src/services/CommissionBandService.java": {},
        "backend-api/src/repositories/NcmPackagingRuleRepository.java": {},
        "backend-api/src/repositories/UfPackagingRuleRepository.java": {},
      },
    })
    resolveIndexedProject.mockImplementation(async (root: string) => ({
      root: "/repo",
      requestedPath: root,
      meta: await readIndexMeta(root),
    }))
    getCollectionUnsafe.mockResolvedValue({})
    verifyIndex.mockResolvedValue({
      indexed: true,
      files: 4,
      changed: 0,
      missing: 0,
      removed: 0,
      chunkMismatch: false,
    })
  })

  it("clusters broad pricing hits into coherent subthemes", async () => {
    search.mockResolvedValue([
      {
        id: "commission-service",
        content: "public class PriceListCommissionService {}",
        metadata: {
          file: "backend-api/src/services/PriceListCommissionService.java",
          startLine: 1,
          endLine: 40,
          symbolName: "PriceListCommissionService",
          symbolType: "class",
          imports: "commission,price-list",
          language: "java",
        },
        distance: 0.06,
      },
      {
        id: "commission-band",
        content: "public class CommissionBandService {}",
        metadata: {
          file: "backend-api/src/services/CommissionBandService.java",
          startLine: 1,
          endLine: 34,
          symbolName: "CommissionBandService",
          symbolType: "class",
          imports: "commission,margin",
          language: "java",
        },
        distance: 0.08,
      },
      {
        id: "ncm-packaging",
        content: "public class NcmPackagingRuleRepository {}",
        metadata: {
          file: "backend-api/src/repositories/NcmPackagingRuleRepository.java",
          startLine: 1,
          endLine: 26,
          symbolName: "NcmPackagingRuleRepository",
          symbolType: "class",
          imports: "ncm,packaging",
          language: "java",
        },
        distance: 0.1,
      },
      {
        id: "uf-packaging",
        content: "public class UfPackagingRuleRepository {}",
        metadata: {
          file: "backend-api/src/repositories/UfPackagingRuleRepository.java",
          startLine: 1,
          endLine: 24,
          symbolName: "UfPackagingRuleRepository",
          symbolType: "class",
          imports: "uf,packaging",
          language: "java",
        },
        distance: 0.12,
      },
    ])

    listDocuments.mockImplementation(async (_collection, options) => {
      const ids = options.filters?.all?.find((filter: any) => filter.key === "id")?.value ?? []
      const docs = [
        {
          id: "commission-service",
          vector: [1, 0, 0],
          metadata: {
            file: "backend-api/src/services/PriceListCommissionService.java",
            startLine: 1,
            endLine: 40,
            symbolName: "PriceListCommissionService",
            symbolType: "class",
            imports: "commission,price-list",
            language: "java",
          },
        },
        {
          id: "commission-band",
          vector: [0.98, 0.02, 0],
          metadata: {
            file: "backend-api/src/services/CommissionBandService.java",
            startLine: 1,
            endLine: 34,
            symbolName: "CommissionBandService",
            symbolType: "class",
            imports: "commission,margin",
            language: "java",
          },
        },
        {
          id: "ncm-packaging",
          vector: [0, 1, 0],
          metadata: {
            file: "backend-api/src/repositories/NcmPackagingRuleRepository.java",
            startLine: 1,
            endLine: 26,
            symbolName: "NcmPackagingRuleRepository",
            symbolType: "class",
            imports: "ncm,packaging",
            language: "java",
          },
        },
        {
          id: "uf-packaging",
          vector: [0.02, 0.98, 0],
          metadata: {
            file: "backend-api/src/repositories/UfPackagingRuleRepository.java",
            startLine: 1,
            endLine: 24,
            symbolName: "UfPackagingRuleRepository",
            symbolType: "class",
            imports: "uf,packaging",
            language: "java",
          },
        },
      ]

      return docs.filter((doc) => ids.includes(doc.id))
    })

    const { SenseGrepClusterTool } = await import("./sensegrep-cluster.js")
    const tool = await SenseGrepClusterTool.init()
    const result = await tool.execute(
      {
        query: "price list commission ncm uf packaging",
        limit: 3,
        rawLimit: 10,
        perCluster: 1,
        clusterThreshold: 0.72,
        minClusterSize: 2,
        shake: false,
      },
      {
        sessionID: "test",
        messageID: "test",
        agent: "vitest",
        abort: new AbortController().signal,
        metadata() {},
      },
    )

    expect(result.output).toContain("Clusters for: price list commission ncm uf packaging")
    expect(result.output).toContain("## services / api / commission")
    expect(result.output).toContain("## persistence / data / packaging")
    expect(result.output).toContain("PriceListCommissionService")
    expect(result.output).toContain("NcmPackagingRuleRepository")
    expect((result.clusters as any[]).every((cluster) => cluster.results.length <= 1)).toBe(true)
    expect((result.clusters as any[]).some((cluster) => cluster.omittedResults > 0)).toBe(true)
    expect(listDocuments).toHaveBeenCalledTimes(1)
  })
})
