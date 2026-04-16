import { beforeEach, describe, expect, it, vi } from "vitest"

const readIndexMeta = vi.fn()
const clearProjectCache = vi.fn()
const getCollectionUnsafe = vi.fn()
const search = vi.fn()
const withConfig = vi.fn(async (_config, run: () => Promise<unknown>) => run())

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    clearProjectCache,
    getCollectionUnsafe,
    search,
  },
}))

vi.mock("../semantic/embeddings.js", () => ({
  Embeddings: {
    withConfig,
  },
}))

vi.mock("../semantic/tree-shaker.js", () => ({
  TreeShaker: {},
}))

vi.mock("../project/instance.js", () => ({
  Instance: {
    directory: "/repo",
  },
}))

describe("SenseGrepTool file glob filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "docs/guide.md": {},
        "src/feature.ts": {},
        "src/feature.js": {},
      },
    })
    getCollectionUnsafe.mockResolvedValue({})
  })

  it("applies include before semantic limiting", async () => {
    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")

      expect(fileFilter).toEqual({
        key: "file",
        operator: "in",
        value: ["src/feature.ts"],
      })

      return [
        {
          id: "src/feature.ts:0",
          content: "export function searchFeature() {}",
          metadata: {
            file: "src/feature.ts",
            startLine: 1,
            endLine: 1,
            symbolName: "searchFeature",
            symbolType: "function",
          },
          distance: 0.1,
        },
      ]
    })

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "feature search",
        include: "src/**/*.ts",
        limit: 1,
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

    expect(result.output).toContain("src/feature.ts")
    expect(search).toHaveBeenCalledTimes(1)
  })

  it("supports basename-style globs like *.ts", async () => {
    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")
      expect(fileFilter?.value).toEqual(["src/feature.ts"])

      return [
        {
          id: "src/feature.ts:0",
          content: "export function searchFeature() {}",
          metadata: {
            file: "src/feature.ts",
            startLine: 1,
            endLine: 1,
          },
          distance: 0.1,
        },
      ]
    })

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "feature search",
        include: "*.ts",
        limit: 1,
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

    expect(result.output).toContain("src/feature.ts")
  })

  it("applies exclude before semantic limiting", async () => {
    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")
      expect(fileFilter?.value).toEqual(["src/feature.ts", "src/feature.js"])

      return [
        {
          id: "src/feature.js:0",
          content: "export function searchFeatureJs() {}",
          metadata: {
            file: "src/feature.js",
            startLine: 1,
            endLine: 1,
          },
          distance: 0.2,
        },
      ]
    })

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "feature search",
        exclude: "*.md",
        limit: 1,
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

    expect(result.output).toContain("src/feature.js")
    expect(result.output).not.toContain("docs/guide.md")
  })
})
