import { Log } from "../util/log.js"
import { lazy } from "../util/lazy.js"
import { Global } from "../global/index.js"
import {
  getEmbeddingConfig,
  configureEmbedding,
  withEmbeddingConfig,
  type EmbeddingConfig,
  type EmbeddingOverrides,
  type DeviceType,
} from "./embedding-config.js"
import fs from "fs/promises"
import path from "path"
import { createRequire } from "module"

const log = Log.create({ service: "semantic.embeddings-hf" })

const require = createRequire(import.meta.url)

// Type definitions for @huggingface/transformers outputs
interface TensorLike {
  data: Float32Array | number[]
  dims: number[]
  tolist(): number[][] | number[]
}

interface ClassificationResult {
  label: string
  score: number
}

async function ensureOnnxRuntimeLibs() {
  if (process.platform !== "linux" && process.platform !== "darwin" && process.platform !== "win32") return

  const platform = process.platform
  const arch = process.arch
  const execDir = path.dirname(process.execPath)
  const bundledNodeModules = path.join(execDir, "node_modules")
  const bundledLibDir = path.join(
    bundledNodeModules,
    "onnxruntime-node",
    "bin",
    "napi-v6",
    platform,
    arch,
  )
  const bundledDir = path.join(execDir, "onnxruntime")
  const targetDir = path.join(Global.Path.cache, "onnxruntime", `${platform}-${arch}`)

  const base = `onnxruntime-node/bin/napi-v6/${platform}/${arch}`
  const libFiles =
    platform === "linux"
      ? ["libonnxruntime.so.1"]
      : platform === "darwin"
        ? ["libonnxruntime.1.23.2.dylib"]
        : ["onnxruntime.dll", "DirectML.dll"]

  const useDir = await (async () => {
    const bundledNodeLib = await fs.stat(path.join(bundledLibDir, libFiles[0])).catch(() => null)
    if (bundledNodeLib?.isFile()) return bundledLibDir

    const bundled = await fs.stat(path.join(bundledDir, libFiles[0])).catch(() => null)
    if (bundled?.isFile()) return bundledDir

    await fs.mkdir(targetDir, { recursive: true })
    for (const file of libFiles) {
      const dest = path.join(targetDir, file)
      const exists = await fs.stat(dest).catch(() => null)
      if (exists?.isFile()) continue
      const resolved = require.resolve(`${base}/${file}`)
      await fs.copyFile(resolved, dest)
    }
    return targetDir
  })()

  if (platform === "linux") {
    const current = process.env.LD_LIBRARY_PATH || ""
    if (!current.split(":").includes(useDir)) {
      process.env.LD_LIBRARY_PATH = current ? `${useDir}:${current}` : useDir
    }
  } else if (platform === "darwin") {
    const current = process.env.DYLD_LIBRARY_PATH || ""
    if (!current.split(":").includes(useDir)) {
      process.env.DYLD_LIBRARY_PATH = current ? `${useDir}:${current}` : useDir
    }
  } else if (platform === "win32") {
    const current = process.env.PATH || ""
    if (!current.split(path.delimiter).includes(useDir)) {
      process.env.PATH = current ? `${useDir}${path.delimiter}${current}` : useDir
    }
  }

  if (await fs.stat(bundledNodeModules).catch(() => null)) {
    const nodePath = process.env.NODE_PATH || ""
    if (!nodePath.split(path.delimiter).includes(bundledNodeModules)) {
      process.env.NODE_PATH = nodePath ? `${bundledNodeModules}${path.delimiter}${nodePath}` : bundledNodeModules
      const Module = require("module")
      Module?.Module?._initPaths?.()
    }
  }
}

// Detect best available device for the current environment
async function detectDevice(): Promise<DeviceType> {
  // Check if running in browser
  const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined"

  if (isBrowser) {
    // Browser environment - check for WebGPU
    if ("gpu" in navigator) {
      const gpu = (navigator as any).gpu
      if (gpu) {
        const adapter = await gpu.requestAdapter().catch(() => null)
        if (adapter) {
          log.info("WebGPU available, using GPU acceleration")
          return "webgpu"
        }
      }
    }
    log.info("WebGPU not available in browser, using WASM backend")
    return "wasm"
  }

  // Node.js environment
  const deviceEnv = process.env.OPENCODE_EMBEDDINGS_DEVICE?.toLowerCase()

  if (deviceEnv === "cuda") {
    log.info("CUDA device requested via OPENCODE_EMBEDDINGS_DEVICE=cuda")
    return "cuda"
  }

  // Default to CPU for Node.js (safest option, always works)
  log.info("Using CPU device for embeddings")
  return "cpu"
}

// Use dynamic import for @huggingface/transformers (ESM module)
const transformersModule = lazy(async () => {
  await ensureOnnxRuntimeLibs()
  return await import("@huggingface/transformers")
})

async function resolveDevice(config: EmbeddingConfig): Promise<DeviceType> {
  if (config.device) return config.device
  return detectDevice()
}

async function getTransformers(config: EmbeddingConfig) {
  const transformers = await transformersModule()
  const { pipeline, env } = transformers
  env.allowLocalModels = false
  const device = await resolveDevice(config)
  return { pipeline, env, device, transformers }
}

export namespace EmbeddingsHF {
  type TaskType =
    | "DEFAULT"
    | "RETRIEVAL_QUERY"
    | "RETRIEVAL_DOCUMENT"
    | "SEMANTIC_SIMILARITY"
    | "CLASSIFICATION"
    | "CLUSTERING"
    | "QUESTION_ANSWERING"
    | "FACT_VERIFICATION"
    | "CODE_RETRIEVAL_QUERY"

  type EmbedOptions = {
    taskType?: TaskType
    title?: string | string[]
    outputDimensionality?: number
  }

  function embeddingProvider(config: EmbeddingConfig) {
    return config.provider
  }

  const embeddingPipelines = new Map<string, Promise<any>>()
  const rerankerPipelines = new Map<string, Promise<{ tokenizer: any; model: any }>>()

  function embeddingKey(config: EmbeddingConfig, device: DeviceType) {
    return `${config.embedModel}:${device}`
  }

  function rerankKey(config: EmbeddingConfig, device: DeviceType) {
    return `${config.rerankModel}:${device}`
  }

  async function embeddingPipeline(config: EmbeddingConfig) {
    const { pipeline, device } = await getTransformers(config)
    const key = embeddingKey(config, device)
    if (!embeddingPipelines.has(key)) {
      embeddingPipelines.set(
        key,
        (async () => {
          log.info("loading embedding model (HuggingFace transformers v3)", { model: config.embedModel })
          const pipe = await pipeline("feature-extraction", config.embedModel, {
            device,
            dtype: "fp32",
          })
          log.info("embedding model loaded", { device })
          return pipe
        })(),
      )
    }
    return embeddingPipelines.get(key)!
  }

  async function rerankerPipeline(config: EmbeddingConfig) {
    const { transformers, device } = await getTransformers(config)
    const key = rerankKey(config, device)
    if (!rerankerPipelines.has(key)) {
      rerankerPipelines.set(
        key,
        (async () => {
          log.info("loading reranker model (HuggingFace transformers v3)", { model: config.rerankModel })
          const tokenizer = await transformers.AutoTokenizer.from_pretrained(config.rerankModel)
          const model = await transformers.AutoModelForSequenceClassification.from_pretrained(config.rerankModel, {
            device,
            dtype: "fp32",
          })
          log.info("reranker model loaded", { device })
          return { tokenizer, model }
        })(),
      )
    }
    return rerankerPipelines.get(key)!
  }

  /**
   * Generate embeddings for text(s)
   * Returns normalized embeddings suitable for cosine similarity
   */
  export async function embed(texts: string | string[], options?: EmbedOptions): Promise<number[][]> {
    const input = Array.isArray(texts) ? texts : [texts]
    if (input.length === 0) return []

    const config = getEmbeddingConfig()
    if (embeddingProvider(config) === "gemini") {
      return embedGemini(input, options, config)
    }

    const pipe = await embeddingPipeline(config)
    const results: number[][] = []

    // Process in batches to avoid memory issues
    const batchSize = 32
    for (let i = 0; i < input.length; i += batchSize) {
      const batch = input.slice(i, i + batchSize)
      const output = await pipe(batch, {
        pooling: "mean",
        normalize: true,
      })

      // Extract embeddings from tensor
      // In v3, output is a Tensor with tolist() method
      const tensor = output as unknown as TensorLike
      if (typeof tensor.tolist === "function") {
        const list = tensor.tolist()
        // For batch processing, list is number[][]
        if (Array.isArray(list[0])) {
          results.push(...(list as number[][]))
        } else {
          results.push(list as number[])
        }
      } else {
        // Fallback for older tensor format
        const data = tensor.data ?? (output as unknown as TensorLike).data
        const dims = tensor.dims ?? (output as unknown as TensorLike).dims
        const embeddingSize = dims[dims.length - 1] || 384

        for (let j = 0; j < batch.length; j++) {
          const start = j * embeddingSize
          const end = (j + 1) * embeddingSize
          const embedding = Array.from(data as Float32Array).slice(start, end)
          results.push(embedding)
        }
      }
    }

    return results
  }

  async function embedGemini(
    texts: string[],
    options: EmbedOptions | undefined,
    config: EmbeddingConfig,
  ): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Gemini embeddings requested but GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Set OPENCODE_SEMANTIC_EMBEDDINGS=local to force local embeddings.",
      )
    }

    const model = config.embedModel
    const outputDimensionality = Number(config.embedDim || options?.outputDimensionality || 768)
    const taskType = options?.taskType
    const titles = typeof options?.title === "string" ? texts.map(() => options!.title as string) : options?.title

    // Gemini "batchEmbedContents" accepts max 100 documents.
    // We'll process in chunks of 64 to be safe.
    const BATCH_SIZE = 64
    const allVectors: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + BATCH_SIZE)
      const batchTitles = Array.isArray(titles) ? titles.slice(i, i + BATCH_SIZE) : undefined

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`

      const requests = batchTexts.map((text, idx) => {
        const req: any = {
          model: `models/${model}`,
          content: {
            parts: [{ text }],
          },
        }
        if (taskType) req.taskType = taskType
        if (
          typeof outputDimensionality === "number" &&
          Number.isFinite(outputDimensionality) &&
          outputDimensionality > 0
        ) {
          req.outputDimensionality = outputDimensionality
        }

        const title = batchTitles ? batchTitles[idx] : undefined
        if (title && taskType === "RETRIEVAL_DOCUMENT") req.title = title
        return req
      })

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ requests }),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => "")
        throw new Error(`Gemini embeddings request failed (${resp.status}): ${text || resp.statusText}`)
      }

      const data = (await resp.json().catch(() => ({}))) as any
      const embeddings: any[] = Array.isArray(data.embeddings)
        ? data.embeddings
        : data.embedding
          ? [data.embedding]
          : Array.isArray(data.embeddings?.embeddings)
            ? data.embeddings.embeddings
            : []

      const vectors = embeddings.map((e) => {
        const values = e?.values
        if (!Array.isArray(values)) return []
        return normalize(values.map((v: any) => Number(v)))
      })

      allVectors.push(...vectors)
    }

    if (allVectors.length !== texts.length) {
      log.warn("gemini embeddings count mismatch", { expected: texts.length, got: allVectors.length })
    }

    return allVectors
  }

  function normalize(vec: number[]): number[] {
    let sum = 0
    for (const v of vec) sum += v * v
    const norm = Math.sqrt(sum)
    if (!Number.isFinite(norm) || norm <= 0) return vec
    return vec.map((v) => v / norm)
  }

  /**
   * Rerank documents based on query relevance
   * Returns scores for each document (higher = more relevant)
   */
  export async function rerank(query: string, documents: string[]): Promise<{ index: number; score: number }[]> {
    if (documents.length === 0) return []

    const config = getEmbeddingConfig()
    const { tokenizer, model } = await rerankerPipeline(config)
    const scores: { index: number; score: number }[] = []

    // Create query-document pairs for cross-encoder
    // Process one at a time to get individual scores
    for (let i = 0; i < documents.length; i++) {
      // Cross-encoder expects query and document as a pair
      const inputs = await tokenizer([query], { text_pair: [documents[i]], padding: true, truncation: true })
      const output = await model(inputs)
      // For cross-encoders, the logits are the relevance score
      const logits = output.logits as TensorLike
      const score = (logits.data as Float32Array)[0]
      scores.push({ index: i, score })
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score)
  }

  /**
   * Get embedding dimension for the model
   */
  export function getDimension(): number {
    return getEmbeddingConfig().embedDim
  }

  /**
   * Get current embeddings provider ("local" or "gemini")
   */
  export function getProvider(): string {
    return getEmbeddingConfig().provider
  }

  /**
   * Preload models (call during initialization)
   */
  export async function preload(): Promise<void> {
    const config = getEmbeddingConfig()
    log.info("preloading models (HuggingFace transformers v3)")
    await Promise.all([
      embeddingProvider(config) === "local" ? embeddingPipeline(config) : Promise.resolve(),
      rerankerPipeline(config),
    ])
    log.info("models preloaded")
  }

  /**
   * Get the current device being used
   */
  export async function getDevice(): Promise<string> {
    const config = getEmbeddingConfig()
    return await resolveDevice(config)
  }

  export function getModel(): string {
    return getEmbeddingConfig().embedModel
  }

  export function getRerankModel(): string {
    return getEmbeddingConfig().rerankModel
  }

  export function getConfig(): EmbeddingConfig {
    return getEmbeddingConfig()
  }

  export function configure(overrides: EmbeddingOverrides) {
    configureEmbedding(overrides)
  }

  export async function withConfig<T>(overrides: EmbeddingOverrides, fn: () => Promise<T>): Promise<T> {
    return withEmbeddingConfig(overrides, fn)
  }
}
