import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const readIndexMeta = vi.fn()
const resolveIndexedProject = vi.fn()
const clearProjectCache = vi.fn()
const getCollectionUnsafe = vi.fn()
const search = vi.fn()
const listDocuments = vi.fn()
const withConfig = vi.fn(async (_config, run: () => Promise<unknown>) => run())
const filepath = vi.fn(async () => "rg")
const spawn = vi.fn()
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
    provide: async (input: { fn: () => unknown }) => input.fn(),
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
    resolveIndexedProject.mockImplementation(async (root: string) => ({
      root: "/repo",
      requestedPath: root,
      meta: await readIndexMeta(root),
    }))
    getCollectionUnsafe.mockResolvedValue({})
    listDocuments.mockResolvedValue([])
    verifyIndex.mockResolvedValue({
      indexed: true,
      files: 3,
      changed: 0,
      missing: 0,
      removed: 0,
      chunkMismatch: false,
    })
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

  it("returns structured warnings when include matches no indexed files", async () => {
    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "calendar sync",
        include: "convex/**/*.ts",
        limit: 3,
      },
      {
        sessionID: "test",
        messageID: "test",
        agent: "vitest",
        abort: new AbortController().signal,
        metadata() {},
      },
    )

    expect(result.results).toEqual([])
    expect(result.warnings).toEqual([
      'No indexed files matched the file filters (include="convex/**/*.ts").',
    ])
    expect(result.output).toContain("No indexed files matched")
    expect(search).not.toHaveBeenCalled()
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
      const symbolFilter = options.filters?.all?.find((filter: any) => filter.key === "symbolName")
      if (symbolFilter?.value === "defineNuxtRouteMiddleware") {
        return []
      }
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
    expect(listDocuments).toHaveBeenCalledTimes(2)
    expect(result.output).toContain("frontend-admin/src/middleware/auth.global.ts")
    expect(result.output).toContain("defineNuxtRouteMiddleware")
  })

  it("promotes exact short symbol matches above weak semantic matches", async () => {
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "src/forge/compiler/emitter/emit.ts": {},
        "src/forge/compiler/emitter/context.ts": {},
      },
    })

    search.mockResolvedValue([
      {
        id: "src/forge/compiler/emitter/context.ts:0",
        content: "export function buildRenderContext() {}",
        metadata: {
          file: "src/forge/compiler/emitter/context.ts",
          startLine: 1,
          endLine: 3,
          symbolName: "buildRenderContext",
          symbolType: "function",
        },
        distance: 0.7,
      },
    ])
    listDocuments.mockImplementation(async (_collection, options) => {
      expect(options.filters?.all).toEqual(
        expect.arrayContaining([
          { key: "symbolName", operator: "equals", value: "emit" },
        ]),
      )
      return [
        {
          id: "src/forge/compiler/emitter/emit.ts:emit",
          content: "export async function emit() {\n  await writeFileAtomic()\n}",
          metadata: {
            file: "src/forge/compiler/emitter/emit.ts",
            startLine: 1,
            endLine: 12,
            symbolName: "emit",
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
        query: "emit",
        include: "src/forge/compiler/emitter/**",
        limit: 3,
      },
      {
        sessionID: "test",
        messageID: "test",
        agent: "vitest",
        abort: new AbortController().signal,
        metadata() {},
      },
    )

    expect(result.results?.[0]).toMatchObject({
      symbolName: "emit",
      confidence: "high",
      isWeakMatch: false,
    })
    expect(search).not.toHaveBeenCalled()
    expect(result.output).toContain("export async function emit()")
    expect(result.output).not.toContain("hidden")
  })

  it("falls back to pattern matches while preserving structural filters", async () => {
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "convex/model/notification_delivery.ts": {},
      },
    })

    search.mockResolvedValue([])
    spawn.mockImplementationOnce((_command, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      queueMicrotask(() => {
        expect(args).toEqual(expect.arrayContaining(["--regexp", "idempotencyKey|getResend"]))
        proc.stdout.emit(
          "data",
          Buffer.from("convex/model/notification_delivery.ts:8:const idempotencyKey = getResendKey()"),
        )
        proc.emit("close", 0)
      })

      return proc
    })
    listDocuments.mockImplementation(async (_collection, options) => {
      expect(options.filters?.all).toEqual(
        expect.arrayContaining([
          { key: "parentScope", operator: "contains", value: "NotificationDeliveryModel" },
        ]),
      )
      const fileFilter = options.filters?.all?.findLast((filter: any) => filter.key === "file")
      expect(fileFilter?.value).toEqual(expect.arrayContaining(["convex/model/notification_delivery.ts"]))

      return [
        {
          id: "convex/model/notification_delivery.ts:sendEmailNotification",
          content: "async sendEmailNotification() {\n  const idempotencyKey = getResendKey()\n}",
          metadata: {
            file: "convex/model/notification_delivery.ts",
            startLine: 1,
            endLine: 12,
            symbolName: "sendEmailNotification",
            symbolType: "method",
            parentScope: "NotificationDeliveryModel",
            semanticKind: "convexInternalMutation",
            framework: "convex",
          },
          distance: 0,
        },
      ]
    })

    const { SenseGrepTool } = await import("./sensegrep.js")
    const tool = await SenseGrepTool.init()
    const result = await tool.execute(
      {
        query: "email notification",
        parentScope: "NotificationDeliveryModel",
        pattern: "idempotencyKey|getResend",
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
    expect(result.output).toContain("convex/model/notification_delivery.ts")
    expect(result.output).toContain("sendEmailNotification")
    expect(result.results?.[0]).toMatchObject({
      confidence: "high",
      isWeakMatch: false,
      semanticKind: "convexInternalMutation",
      framework: "convex",
      whyMatched: expect.arrayContaining([
        "semantic similarity",
        "pattern matched: idempotencyKey|getResend",
        "parent matched: NotificationDeliveryModel",
      ]),
      filterMatches: {
        parent: {
          matched: true,
          mode: "metadata",
          value: "NotificationDeliveryModel",
        },
      },
    })
  })

  it("batches ripgrep file arguments to avoid command length issues", async () => {
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
