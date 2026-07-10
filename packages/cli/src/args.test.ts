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

  it("accepts global projection and formatting flags", () => {
    expect(validateKnownFlags("references", { pretty: true, diagnostic: true, "json-detail": "minimal" })).toBeUndefined()
    expect(validateKnownFlags("detect-duplicates", { pretty: true, "json-detail": "diagnostic" })).toBeUndefined()
  })

  it("rejects flags outside the command contract", () => {
    expect(validateKnownFlags("status", { threshold: "0.8" })).toBe("threshold")
  })

  it("accepts deterministic literal search flags", () => {
    expect(validateKnownFlags("literal", { regex: true, "ignore-case": true, include: "src/**", limit: "20" })).toBeUndefined()
  })

  it("accepts embedding timeout and global audit budgets", () => {
    expect(validateKnownFlags("search", { "embedding-timeout": "1000" })).toBeUndefined()
    expect(validateKnownFlags("audit", {
      "max-total-tokens": "8000",
      "max-output-bytes": "32000",
      "max-batches": "8",
    })).toBeUndefined()
  })
})
