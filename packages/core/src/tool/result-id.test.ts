import { describe, expect, it } from "vitest"
import { createResultId, decodeResultId } from "./result-id.js"

describe("result IDs", () => {
  const location = { file: "src/webhooks/handler.ts", startLine: 120, endLine: 178, symbol: "validateWebhook" }

  it("encodes a compact deterministic self-contained location", () => {
    const resultId = createResultId(location)
    const legacy = `symbol:${Buffer.from(JSON.stringify(location)).toString("base64url")}`

    expect(resultId.startsWith("r:")).toBe(true)
    expect(resultId.length).toBeLessThan(legacy.length)
    expect(decodeResultId(resultId)).toEqual(location)
    expect(createResultId(location)).toBe(resultId)
  })

  it("continues to decode legacy symbol IDs", () => {
    const legacy = `symbol:${Buffer.from(JSON.stringify(location)).toString("base64url")}`
    expect(decodeResultId(legacy)).toEqual(location)
  })

  it("rejects malformed and unsafe location shapes", () => {
    expect(() => decodeResultId("r:broken")).toThrow(/Invalid result ID/)
    expect(() => decodeResultId("unknown:value")).toThrow(/Invalid result ID/)
  })
})
