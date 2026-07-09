import { describe, expect, it } from "vitest"
import { getGeneralChunkLimits } from "./chunk-limits.js"
import { Chunking } from "./chunking.js"

describe("Chunking oversized content", () => {
  it("splits very large single-line code into safe chunks", () => {
    const content = `const payload = "${"a".repeat(20_000)}";`
    const chunks = Chunking.chunk(content, "src/generated/bundle.js")
    const limits = getGeneralChunkLimits()

    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((chunk) => chunk.content.length))).toBeLessThanOrEqual(limits.max)
    expect(chunks.every((chunk) => chunk.startLine === 1 && chunk.endLine === 1)).toBe(true)
  })

  it("adds bounded adaptive overlap instead of a fixed large prefix", () => {
    const limits = getGeneralChunkLimits()
    const chunks = Chunking.addOverlap([
      { content: "a".repeat(1000), startLine: 1, endLine: 1, type: "code" },
      { content: "b".repeat(400), startLine: 2, endLine: 2, type: "code" },
    ])

    const match = chunks[1].content.match(/^\.\.\.(a+)\n\n/)
    const expectedOverlap = Math.min(
      limits.overlap,
      Math.floor(Math.ceil(400 / limits.charsPerToken) * 0.15) * limits.charsPerToken,
    )

    expect(match?.[1].length).toBe(expectedOverlap)
    expect(expectedOverlap).toBeLessThan(limits.overlap)
  })

  it("keeps chunks under the configured limit after overlap is added", () => {
    const limits = getGeneralChunkLimits()
    const chunks = Chunking.addOverlap([
      { content: "a".repeat(limits.overlap * 2), startLine: 1, endLine: 1, type: "code" },
      { content: "b".repeat(limits.max - 2), startLine: 2, endLine: 2, type: "code" },
    ])

    expect(chunks[1].content.length).toBeLessThanOrEqual(limits.max)
  })

  it("indexes methods inside exported TypeScript classes with parent scope metadata", async () => {
    const content = `
export class GoogleCalendarModel {
  private readonly channelPrefix = "google-calendar"

  async syncWebhook(payload: CalendarWebhookPayload) {
    const channel = await this.loadChannel(payload.channelId)
    if (!channel) {
      throw new Error("Unknown calendar webhook channel")
    }
    await this.refreshWatchChannel(channel.userId, payload.resourceId)
    return { ok: true, channel }
  }

  refreshWatchChannel(userId: string, resourceId: string) {
    const idempotencyKey = [this.channelPrefix, userId, resourceId].join(":")
    return {
      idempotencyKey,
      expiresAt: Date.now() + 60_000,
    }
  }

  private async loadChannel(channelId: string) {
    return { channelId, userId: "user_123" }
  }
}
`

    const chunks = await Chunking.chunkAsync(content, "convex/model/google_calendar.ts")
    const classChunk = chunks.find((chunk) => chunk.symbolName === "GoogleCalendarModel")
    const methodChunks = chunks.filter((chunk) => chunk.symbolType === "method")

    expect(classChunk).toMatchObject({
      symbolName: "GoogleCalendarModel",
      symbolType: "class",
      isExported: true,
    })
    expect(methodChunks.map((chunk) => chunk.symbolName)).toEqual(
      expect.arrayContaining(["syncWebhook", "refreshWatchChannel", "loadChannel"]),
    )
    expect(methodChunks.every((chunk) => chunk.parentScope === "GoogleCalendarModel")).toBe(true)
    expect(methodChunks.find((chunk) => chunk.symbolName === "syncWebhook")).toMatchObject({
      isAsync: true,
      variant: "async",
    })
    expect(methodChunks.find((chunk) => chunk.symbolName === "loadChannel")).toMatchObject({
      isAsync: true,
      variant: "async",
    })
    expect(methodChunks.find((chunk) => chunk.symbolName === "refreshWatchChannel")).toMatchObject({
      isAsync: false,
    })
  })

  it("infers framework-aware semantic kind metadata for TypeScript wrappers", async () => {
    const content = `
import { internalMutation, httpAction } from "./_generated/server"

export const sendEmailNotification = internalMutation({
  handler: async (ctx, args) => {
    return { ok: true }
  },
})

export const webhook = httpAction(async (ctx, request) => {
  return new Response("ok")
})

export function useCalendarSync() {
  return { enabled: true }
}
`

    const chunks = await Chunking.chunkAsync(content, "convex/model/notification_delivery.ts")
    expect(chunks.find((chunk) => chunk.symbolName === "sendEmailNotification")).toMatchObject({
      semanticKind: "convexInternalMutation",
      framework: "convex",
    })
    expect(chunks.find((chunk) => chunk.symbolName === "webhook")).toMatchObject({
      semanticKind: "convexHttpAction",
      framework: "convex",
    })
    expect(chunks.find((chunk) => chunk.symbolName === "useCalendarSync")).toMatchObject({
      semanticKind: "reactHook",
      framework: "react",
    })
  })

  it("indexes internal functions inside exported TypeScript namespaces with parent scope metadata", async () => {
    const content = `
export namespace EmbeddingsRemote {
  const TOKEN_LIMITS = {
    qwen3: 8192,
  }

  async function embedOpenAI(texts: string[]) {
    return texts.map((text) => [text.length])
  }

  export function createLimiter(limit: number) {
    return { limit }
  }
}
`

    const chunks = await Chunking.chunkAsync(content, "packages/core/src/semantic/embeddings-remote.ts")
    const internalFunction = chunks.find((chunk) => chunk.symbolName === "embedOpenAI")
    const exportedFunction = chunks.find((chunk) => chunk.symbolName === "createLimiter")

    expect(chunks.find((chunk) => chunk.symbolName === "EmbeddingsRemote")).toMatchObject({
      symbolType: "namespace",
      isExported: true,
    })
    expect(internalFunction).toMatchObject({
      symbolName: "embedOpenAI",
      symbolType: "function",
      parentScope: "EmbeddingsRemote",
      isAsync: true,
      variant: "async",
      isExported: false,
    })
    expect(internalFunction?.content).toContain("// Namespace: EmbeddingsRemote")
    expect(exportedFunction).toMatchObject({
      symbolName: "createLimiter",
      symbolType: "function",
      parentScope: "EmbeddingsRemote",
      isExported: true,
    })
  })

  it("splits complex TypeScript functions using the complex adaptive limit", async () => {
    const branches = Array.from(
      { length: 24 },
      (_, index) => `
  if (input > ${index}) {
    total += ${index}
  } else {
    total -= ${index}
  }
  total += "${"x".repeat(120)}".length`,
    ).join("\n")
    const content = `
export function complexFlow(input: number) {
  let total = 0
${branches}
  return total
}
`

    const chunks = await Chunking.chunkAsync(content, "src/complex-flow.ts")
    const functionChunks = chunks.filter((chunk) => chunk.symbolName === "complexFlow")

    expect(content.length).toBeLessThan(getGeneralChunkLimits().max)
    expect(functionChunks.length).toBeGreaterThan(1)
    expect(functionChunks.every((chunk) => chunk.symbolType === "function")).toBe(true)
    const locations = new Set(
      functionChunks.map((chunk) => `${chunk.startLine}:${chunk.endLine}:${chunk.symbolName}:${chunk.symbolType}`),
    )
    expect(locations.size).toBe(functionChunks.length)
  })
})
