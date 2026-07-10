import { describe, expect, it } from "vitest"
import { parseArgs, validateKnownFlags } from "./args.js"

describe("CLI arguments", () => {
  it("parses positional, separated, and inline values", () => {
    expect(parseArgs(["search", "auth", "--limit=5", "--json"])).toEqual({
      positional: ["search", "auth"],
      flags: { limit: "5", json: true },
    })
  })

  it("treats log-format as a global flag", () => {
    expect(validateKnownFlags("status", { "log-format": "none" })).toBeUndefined()
    expect(validateKnownFlags("selftest", { "log-format": "none" })).toBeUndefined()
  })

  it("rejects flags outside the command contract", () => {
    expect(validateKnownFlags("status", { threshold: "0.8" })).toBe("threshold")
  })
})
