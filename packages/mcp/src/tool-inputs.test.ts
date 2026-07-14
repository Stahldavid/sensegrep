import { describe, expect, it } from "vitest"
import z from "zod"
import { DuplicateToolArgsSchema, IndexToolArgsSchema, toRootedInputSchema } from "./tool-inputs.js"

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

  it("omits internal and command-specific duplicate fields from public schemas", () => {
    const schema = toRootedInputSchema(z.object({
      query: z.string(),
      commandName: z.string(),
      resultDetail: z.string(),
    }), ["resultDetail"])

    expect(schema.properties).toMatchObject({ query: { type: "string" } })
    expect(schema.properties).not.toHaveProperty("commandName")
    expect(schema.properties).not.toHaveProperty("resultDetail")
    expect(schema.required).toEqual(["query"])
  })
})
