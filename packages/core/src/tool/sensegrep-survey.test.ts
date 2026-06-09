import { beforeEach, describe, expect, it, vi } from "vitest"

const readIndexMeta = vi.fn()
const resolveIndexedProject = vi.fn()
const clearProjectCache = vi.fn()
const getCollectionUnsafe = vi.fn()
const search = vi.fn()
const withConfig = vi.fn(async (_config, run: () => Promise<unknown>) => run())
const verifyIndex = vi.fn()

vi.mock("../semantic/lancedb.js", () => ({
  VectorStore: {
    readIndexMeta,
    resolveIndexedProject,
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

describe("SenseGrepSurveyTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readIndexMeta.mockResolvedValue({
      embeddings: {
        provider: "gemini",
        model: "test-model",
        dimension: 3,
      },
      files: {
        "frontend-admin/src/middleware/auth.global.ts": {},
        "frontend-store/stores/auth.ts": {},
        "frontend-admin/src/services/userService.ts": {},
        "frontend-store/types/auth.ts": {},
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

  it("groups broad auth results into readable domain sections", async () => {
    search.mockResolvedValue([
      {
        id: "auth-middleware",
        content: "export default defineNuxtRouteMiddleware(() => {})",
        metadata: {
          file: "frontend-admin/src/middleware/auth.global.ts",
          startLine: 1,
          endLine: 8,
          symbolName: "auth",
          symbolType: "function",
          imports: "nuxt,session",
          language: "typescript",
        },
        distance: 0.06,
      },
      {
        id: "auth-store",
        content: "export const useAuthStore = defineStore('auth', {})",
        metadata: {
          file: "frontend-store/stores/auth.ts",
          startLine: 1,
          endLine: 20,
          symbolName: "useAuthStore",
          symbolType: "function",
          imports: "pinia",
          language: "typescript",
        },
        distance: 0.08,
      },
      {
        id: "user-service",
        content: "export async function refreshToken() {}",
        metadata: {
          file: "frontend-admin/src/services/userService.ts",
          startLine: 10,
          endLine: 28,
          symbolName: "refreshToken",
          symbolType: "function",
          imports: "axios",
          language: "typescript",
        },
        distance: 0.11,
      },
      {
        id: "auth-types",
        content: "export interface AuthSession { token: string }",
        metadata: {
          file: "frontend-store/types/auth.ts",
          startLine: 1,
          endLine: 8,
          symbolName: "AuthSession",
          symbolType: "type",
          language: "typescript",
        },
        distance: 0.14,
      },
    ])

    const { SenseGrepSurveyTool } = await import("./sensegrep-survey.js")
    const tool = await SenseGrepSurveyTool.init()
    const result = await tool.execute(
      {
        query: "authentication login token",
        limit: 4,
        perGroup: 1,
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

    expect(result.output).toContain("Survey for: authentication login token")
    expect(result.output).toContain("## middleware / guards")
    expect(result.output).toContain("## stores / state")
    expect(result.output).toContain("## services / api")
    expect(result.output).toContain("## types / contracts")
    expect(result.output).toContain("frontend-admin/src/middleware/auth.global.ts")
    expect(result.output).toContain("frontend-store/stores/auth.ts")
    expect(search).toHaveBeenCalledTimes(1)
  })
})
