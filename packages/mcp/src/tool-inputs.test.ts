import { describe, expect, it } from "vitest"
import { DuplicateToolArgsSchema, IndexToolArgsSchema } from "./tool-inputs.js"

describe("MCP tool input schemas", () => {
  it("rejects invalid duplicate detector ranges and scopes", () => {
    expect(() => DuplicateToolArgsSchema.parse({ threshold: 2 })).toThrow()
    expect(() => DuplicateToolArgsSchema.parse({ limit: -1 })).toThrow()
    expect(() => DuplicateToolArgsSchema.parse({ scope: "function,typo" })).toThrow()
    expect(() => DuplicateToolArgsSchema.parse({ scope: "all,function" })).toThrow()
  })

  it("rejects unknown index modes instead of treating them as incremental", () => {
    expect(() => IndexToolArgsSchema.parse({ mode: "typo" })).toThrow()
  })

  it("applies operational defaults", () => {
    expect(IndexToolArgsSchema.parse({})).toMatchObject({ action: "index", mode: "incremental" })
    expect(DuplicateToolArgsSchema.parse({})).toMatchObject({ threshold: 0.85, limit: 10 })
  })
})
