import { describe, expect, it, vi } from "vitest"
import type { LanguageSupport } from "./types.js"
import { getLanguageForFile, registerLanguage, unregisterLanguage } from "./registry.js"

function pluginLanguage(): LanguageSupport {
  const noop = vi.fn()
  return {
    id: "testlang",
    displayName: "Test Language",
    extensions: ["testlang"],
    parserWasm: "test.wasm",
    reservedWords: new Set(),
    variants: [],
    decorators: [],
    chunk: async (content) => [{ content, startLine: 1, endLine: 1, type: "code", language: "testlang" }],
    isChunkBoundary: () => true,
    shouldSkipNode: () => false,
    extractMetadata: noop,
    extractNodeName: () => undefined,
    calculateComplexity: () => 0,
    isExported: () => false,
    isAsync: () => false,
    isStatic: () => false,
    isAbstract: () => false,
    extractDecorators: () => [],
    hasDocumentation: () => false,
    getParentScope: () => undefined,
    getNodeTypes: () => [],
    nodeToSymbolType: () => undefined,
    nodeToVariant: () => undefined,
  } as LanguageSupport
}

describe("language registry plugins", () => {
  it("registers normalized extensions and returns an unload function", () => {
    const dispose = registerLanguage(pluginLanguage())
    expect(getLanguageForFile("src/example.testlang")?.id).toBe("testlang")
    dispose()
    expect(getLanguageForFile("src/example.testlang")).toBeUndefined()
  })

  it("rejects extension collisions unless replacement is explicit", () => {
    const first = pluginLanguage()
    registerLanguage(first)
    expect(() => registerLanguage({ ...first, id: "otherlang" })).toThrow(/already registered/)
    unregisterLanguage(first.id)
  })
})
