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
})
