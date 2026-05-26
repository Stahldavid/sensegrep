import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const readIndexMeta = vi.fn()
const clearProjectCache = vi.fn()
const getCollectionUnsafe = vi.fn()
const search = vi.fn()
const listDocuments = vi.fn()
const withConfig = vi.fn(async (_config, run: () => Promise<unknown>) => run())
const filepath = vi.fn(async () => "rg")
const spawn = vi.fn()

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    clearProjectCache,
    getCollectionUnsafe,
    search,
    listDocuments,
  },
}))

vi.mock("../semantic/embeddings.js", () => ({
  Embeddings: {
    withConfig,
  },
}))

vi.mock("../file/ripgrep.js", () => ({
  Ripgrep: {
    filepath,
  },
}))

vi.mock("node:child_process", () => ({
  spawn,
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
    filepath.mockResolvedValue("rg")
    spawn.mockImplementation((_command, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      queueMicrotask(() => {
        const separatorIndex = args.indexOf("--")
        const fileArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : args.filter((arg) => /[\\/]/.test(arg))
        const files = fileArgs.map((arg) => arg.replace(/\\/g, "/"))
        const output = files
          .map((file) => `${file}:3:defineNuxtRouteMiddleware(() => {})`)
          .join("\n")
        if (output) proc.stdout.emit("data", Buffer.from(output))
        proc.emit("close", 0)
      })

      return proc
    })

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
    listDocuments.mockResolvedValue([])
  })

  it("applies include before semantic limiting", async () => {
    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")

      expect(fileFilter?.key).toBe("file")
      expect(fileFilter?.operator).toBe("in")
      expect(fileFilter?.value).toEqual(
        expect.arrayContaining(["src/feature.ts"]),
      )

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
      expect(fileFilter?.value).toEqual(expect.arrayContaining(["src/feature.ts"]))

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

  it("matches Windows-style indexed paths for nested include globs", async () => {
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "frontend-store\\pages\\checkout\\index.vue": {},
      },
    })

    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")
      expect(fileFilter?.value).toEqual(
        expect.arrayContaining([
          "frontend-store\\pages\\checkout\\index.vue",
          "frontend-store/pages/checkout/index.vue",
        ]),
      )

      return [
        {
          id: "frontend-store/pages/checkout/index.vue:0",
          content: "<script setup lang=\"ts\">const checkout = true</script>",
          metadata: {
            file: "frontend-store/pages/checkout/index.vue",
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
        query: "checkout payment",
        include: "frontend-store/**/*.vue",
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

    expect(result.output).toContain("frontend-store/pages/checkout/index.vue")
  })

  it("applies exclude before semantic limiting", async () => {
    search.mockImplementation(async (_collection, _query, options) => {
      const fileFilter = options.filters?.all?.find((filter: any) => filter.key === "file")
      expect(fileFilter?.value).toEqual(expect.arrayContaining(["src/feature.ts", "src/feature.js"]))

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

  it("falls back to literal identifier matches when semantic search misses them", async () => {
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "frontend-admin/src/middleware/auth.global.ts": {},
      },
    })

    search.mockResolvedValue([])
    listDocuments.mockImplementation(async (_collection, options) => {
      const languageFilter = options.filters?.all?.find((filter: any) => filter.key === "language")
      const fileFilter = options.filters?.all?.findLast((filter: any) => filter.key === "file")
      expect(languageFilter).toEqual({
        key: "language",
        operator: "equals",
        value: "typescript",
      })
      expect(fileFilter?.value).toEqual(
        expect.arrayContaining(["frontend-admin/src/middleware/auth.global.ts"]),
      )

      return [
        {
          id: "frontend-admin/src/middleware/auth.global.ts:0",
          content: "export default defineNuxtRouteMiddleware(() => {})",
          metadata: {
            file: "frontend-admin/src/middleware/auth.global.ts",
            startLine: 1,
            endLine: 8,
            symbolName: "auth",
            symbolType: "function",
            language: "typescript",
          },
          distance: 0,
        },
      ]
    })

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "defineNuxtRouteMiddleware",
        language: "typescript",
        include: "frontend-admin/**/*.ts",
        limit: 3,
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

    expect(search).toHaveBeenCalledTimes(1)
    expect(listDocuments).toHaveBeenCalledTimes(1)
    expect(result.output).toContain("frontend-admin/src/middleware/auth.global.ts")
    expect(result.output).toContain("defineNuxtRouteMiddleware")
  })

  it("batches ripgrep file arguments to avoid Windows command length issues", async () => {
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: Object.fromEntries(
        Array.from({ length: 400 }, (_, i) => [`backend-api/src/module/File${i}.java`, {}]),
      ),
    })

    search.mockResolvedValue([])
    listDocuments.mockResolvedValue([
      {
        id: "backend-api/src/module/File0.java:0",
        content: "class OrderScheduleApi {}",
        metadata: {
          file: "backend-api/src/module/File0.java",
          startLine: 1,
          endLine: 8,
          symbolName: "OrderScheduleApi",
          symbolType: "class",
          language: "java",
        },
        distance: 0,
      },
    ])

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    await tool.execute(
      {
        query: "OrderScheduleApi",
        language: "java",
        include: "backend-api/**/*.java",
        limit: 3,
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

    expect(spawn.mock.calls.length).toBeGreaterThan(1)
    for (const [, args] of spawn.mock.calls) {
      const separatorIndex = args.indexOf("--")
      expect(separatorIndex).toBeGreaterThan(-1)
      const fileArgs = args.slice(separatorIndex + 1)
      expect(fileArgs.every((file: string) => !file.includes("/repo"))).toBe(true)
    }
  })
})
