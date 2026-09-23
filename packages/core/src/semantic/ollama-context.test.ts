import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveOllamaContext } from "./ollama-context.js"

afterEach(() => vi.unstubAllGlobals())
describe("Ollama runtime context", () => {
  it("caps the requested window by the installed model's reported capacity", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model_info: { "custom.context_length": 4096 } }) })
    vi.stubGlobal("fetch", fetch)
    const config = { provider: "ollama" as const, embedModel: "small-fixture", embedDim: 3, contextTokens: 8192 }
    expect(await resolveOllamaContext(config)).toBe(4096)
    expect(await resolveOllamaContext({ ...config, contextTokens: 2048 })).toBe(2048)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("fails visibly on missing metadata and can retry after a failed discovery", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ model_info: { "qwen3.context_length": 32768 } }) })
    vi.stubGlobal("fetch", fetch)
    const config = { provider: "ollama" as const, embedModel: "retry-fixture", embedDim: 3 }
    await expect(resolveOllamaContext(config)).rejects.toThrow("context_length")
    expect(await resolveOllamaContext(config)).toBe(8192)
  })
})
