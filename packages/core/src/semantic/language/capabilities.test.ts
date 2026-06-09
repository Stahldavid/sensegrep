import { describe, it, expect } from "vitest"
import {
  getLanguageCapabilities,
  getAvailableSemanticKinds,
  expandSemanticKindFilter,
  validateVariant,
  validateDecorator,
  validateSymbolType,
} from "./index.js"

describe("language capabilities", () => {
  it("exposes registered languages and symbol types", () => {
    const capabilities = getLanguageCapabilities()

    expect(capabilities.languages).toEqual(
      expect.arrayContaining(["typescript", "javascript", "python", "java", "vue"])
    )
    expect(capabilities.symbolTypes).toContain("function")
    expect(capabilities.symbolTypes).toContain("class")
    expect(capabilities.semanticKinds.map((kind) => kind.name)).toEqual(
      expect.arrayContaining(["convexMutation", "convexHttpAction", "reactComponent", "reactHook"]),
    )
  })

  it("exposes framework-aware semantic kind filters", () => {
    const semanticKinds = getAvailableSemanticKinds()

    expect(semanticKinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "convexInternalMutation",
          framework: "convex",
        }),
        expect.objectContaining({
          name: "routeHandler",
          framework: "web",
        }),
      ]),
    )
  })

  it("expands semantic kind aliases and wildcards", () => {
    expect(expandSemanticKindFilter("convexPrivateMutation")).toEqual(["convexInternalMutation"])
    expect(expandSemanticKindFilter("convex*")).toEqual(
      expect.arrayContaining(["convexQuery", "convexMutation", "convexInternalMutation", "convexHttpAction"]),
    )
  })

  it("validates known variants and suggests close matches", () => {
    expect(validateVariant("interface", "typescript")).toEqual({ valid: true })

    const invalid = validateVariant("interfase", "typescript")
    expect(invalid.valid).toBe(false)
    expect(invalid.suggestion).toBe("interface")

    expect(validateVariant("record", "java")).toEqual({ valid: true })
    expect(validateVariant("component", "vue")).toEqual({ valid: true })
  })

  it("validates decorators by language", () => {
    expect(validateDecorator("@dataclass", "python")).toEqual({ valid: true })

    const invalid = validateDecorator("@dataclas", "python")
    expect(invalid.valid).toBe(false)
    expect(invalid.suggestion).toBe("@dataclass")
  })

  it("validates symbol types and suggests fixes for typos", () => {
    expect(validateSymbolType("method")).toEqual({ valid: true })

    const invalid = validateSymbolType("methd")
    expect(invalid.valid).toBe(false)
    expect(invalid.suggestion).toBe("method")
  })
})
