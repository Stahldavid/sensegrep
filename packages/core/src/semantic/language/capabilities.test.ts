import { describe, it, expect } from "vitest"
import {
  getLanguageCapabilities,
  validateVariant,
  validateDecorator,
  validateSymbolType,
} from "./index.js"

describe("language capabilities", () => {
  it("exposes registered languages and symbol types", () => {
    const capabilities = getLanguageCapabilities()

    expect(capabilities.languages).toEqual(
      expect.arrayContaining(["typescript", "javascript", "python"])
    )
    expect(capabilities.symbolTypes).toContain("function")
    expect(capabilities.symbolTypes).toContain("class")
  })

  it("validates known variants and suggests close matches", () => {
    expect(validateVariant("interface", "typescript")).toEqual({ valid: true })

    const invalid = validateVariant("interfase", "typescript")
    expect(invalid.valid).toBe(false)
    expect(invalid.suggestion).toBe("interface")
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
