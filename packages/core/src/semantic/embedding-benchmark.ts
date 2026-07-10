import { performance } from "node:perf_hooks"
import { Embeddings } from "./embeddings.js"

const SAMPLE_TEMPLATES = [
  `export async function loadUser(id: string) {\n  const response = await fetch(\`/api/users/\${id}\`)\n  if (!response.ok) throw new Error("user request failed")\n  return response.json()\n}`,
  `class TaskQueue {\n  private pending: Array<() => Promise<void>> = []\n  enqueue(task: () => Promise<void>) { this.pending.push(task) }\n  async drain() { for (const task of this.pending.splice(0)) await task() }\n}`,
  `def normalize_records(records):\n    """Normalize imported records by stable identifier."""\n    return {record["id"]: {**record, "active": bool(record.get("active"))} for record in records}`,
  `SELECT project_id, COUNT(*) AS failures\nFROM job_runs\nWHERE status = 'failed' AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'\nGROUP BY project_id`,
]

export namespace EmbeddingBenchmark {
  export type Trial = {
    concurrency: number
    durationMs: number
    inputs: number
    tokens: number
    vectors: number
    dimensions: number
    inputsPerSecond: number
    tokensPerSecond: number
  }

  export type Result = {
    provider: string
    model: string
    dimension: number
    sampleCount: number
    trials: Trial[]
    recommendedConcurrency: number
    recommendedEnvironment: Record<string, string>
  }

  function createSamples(count: number): string[] {
    return Array.from({ length: count }, (_, index) =>
      `${SAMPLE_TEMPLATES[index % SAMPLE_TEMPLATES.length]}\n// benchmark sample ${index + 1}`,
    )
  }

  function estimateTokens(texts: string[]): number {
    return texts.reduce((total, text) => total + Math.max(1, Math.ceil(text.length / 4)), 0)
  }

  export async function run(options: {
    concurrencyCandidates?: number[]
    sampleCount?: number
    repeats?: number
    signal?: AbortSignal
  } = {}): Promise<Result> {
    const config = Embeddings.getConfig()
    const sampleCount = Math.max(4, Math.floor(options.sampleCount ?? 16))
    const repeats = Math.max(1, Math.floor(options.repeats ?? 1))
    const candidates = [...new Set(options.concurrencyCandidates ?? [1, 2, 4])]
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((a, b) => a - b)
    if (candidates.length === 0) throw new Error("At least one positive concurrency candidate is required.")

    const samples = createSamples(sampleCount)
    options.signal?.throwIfAborted()
    await Embeddings.embed(samples.slice(0, 1), { taskType: "RETRIEVAL_DOCUMENT", signal: options.signal })

    const trials: Trial[] = []
    for (const concurrency of candidates) {
      const durations: number[] = []
      let vectors: number[][] = []
      for (let repeat = 0; repeat < repeats; repeat++) {
        options.signal?.throwIfAborted()
        const started = performance.now()
        vectors = await Embeddings.withConfig({ concurrency }, () =>
          Embeddings.embed(samples, { taskType: "RETRIEVAL_DOCUMENT", signal: options.signal }),
        )
        durations.push(performance.now() - started)
      }
      if (vectors.length !== samples.length) {
        throw new Error(`Embedding benchmark returned ${vectors.length} vectors for ${samples.length} inputs.`)
      }
      const dimensions = vectors[0]?.length ?? 0
      if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
        throw new Error("Embedding benchmark returned inconsistent vector dimensions.")
      }
      const durationMs = durations.reduce((total, value) => total + value, 0) / durations.length
      const tokens = estimateTokens(samples)
      trials.push({
        concurrency,
        durationMs,
        inputs: samples.length,
        tokens,
        vectors: vectors.length,
        dimensions,
        inputsPerSecond: samples.length / (durationMs / 1000),
        tokensPerSecond: tokens / (durationMs / 1000),
      })
    }

    const best = [...trials].sort((a, b) => b.inputsPerSecond - a.inputsPerSecond)[0]
    const variable = config.provider === "openai" ? "SENSEGREP_OPENAI_CONCURRENCY" : "SENSEGREP_EMBED_CONCURRENCY"
    return {
      provider: config.provider,
      model: config.embedModel,
      dimension: config.embedDim,
      sampleCount,
      trials,
      recommendedConcurrency: best.concurrency,
      recommendedEnvironment: { [variable]: String(best.concurrency) },
    }
  }
}
