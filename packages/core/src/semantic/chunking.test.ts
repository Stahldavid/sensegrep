import { describe, expect, it } from "vitest"
import { Chunking } from "./chunking.js"

describe("Chunking oversized content", () => {
  it("splits very large single-line code into safe chunks", () => {
    const content = `const payload = "${"a".repeat(20_000)}";`
    const chunks = Chunking.chunk(content, "src/generated/bundle.js")

    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((chunk) => chunk.content.length))).toBeLessThanOrEqual(7_500)
    expect(chunks.every((chunk) => chunk.startLine === 1 && chunk.endLine === 1)).toBe(true)
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
  })
})
