import { Log } from "@/util/log"
import { lazy } from "@/util/lazy"
import { Global } from "@/global"
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

// Device type for @huggingface/transformers v3 in Node.js
// Node.js supports: "cpu" | "cuda" (NVIDIA GPU)
// Browser supports: "webgpu" | "wasm"
type DeviceType = "cpu" | "cuda" | "webgpu" | "wasm"

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
    "napi-v3",
    platform,
    arch,
  )
  const bundledDir = path.join(execDir, "onnxruntime")
  const targetDir = path.join(Global.Path.cache, "onnxruntime", `${platform}-${arch}`)

  const base = `onnxruntime-node/bin/napi-v3/${platform}/${arch}`
  const libFiles =
    platform === "linux"
      ? ["libonnxruntime.so.1", "libonnxruntime.so.1.21.0", "libonnxruntime_providers_shared.so"]
      : platform === "darwin"
        ? ["libonnxruntime.1.21.0.dylib"]
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
      await Bun.write(dest, Bun.file(resolved))
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
const getTransformers = lazy(async () => {
  await ensureOnnxRuntimeLibs()
  const transformers = await import("@huggingface/transformers")
  const { pipeline, env } = transformers

  // Disable local model check to always use cache
  env.allowLocalModels = false

  // Detect and set device
  const device = await detectDevice()

  return { pipeline, env, device, transformers }
})

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

  type EmbeddingProvider = "local" | "gemini"

  function embeddingProvider(): EmbeddingProvider {
    const forced = process.env.OPENCODE_SEMANTIC_EMBEDDINGS?.toLowerCase()
    if (forced === "gemini") return "gemini"
    if (forced === "local") return "local"

    // Prefer Gemini when configured.
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini"
    return "local"
  }

  // Model configuration (local) - using HuggingFace models compatible with v3
  // BAAI/bge-small-en-v1.5: 33M parameters, 384 dims, ONNX-optimized
  // MTEB score 62.17 - one of the best small embedding models
  const LOCAL_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
  const RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"

  // Lazy-loaded pipelines
  const embeddingPipeline = lazy(async () => {
    log.info("loading embedding model (HuggingFace transformers v3)", { model: LOCAL_EMBEDDING_MODEL })
    const { pipeline, device } = await getTransformers()
    const pipe = await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, {
      device,
      dtype: "fp32", // Use fp32 for best compatibility, can use "fp16" on WebGPU for speed
    })
    log.info("embedding model loaded", { device })
    return pipe
  })

  const rerankerPipeline = lazy(async () => {
    log.info("loading reranker model (HuggingFace transformers v3)", { model: RERANKER_MODEL })
    const { transformers, device } = await getTransformers()
    // For cross-encoder reranking, we need direct access to model and tokenizer
    // to get raw logits (the pipeline applies softmax which doesn't work well for cross-encoders)
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(RERANKER_MODEL)
    const model = await transformers.AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
      device,
      dtype: "fp32",
    })
    log.info("reranker model loaded", { device })
    return { tokenizer, model }
  })

  /**
   * Generate embeddings for text(s)
   * Returns normalized embeddings suitable for cosine similarity
   */
  export async function embed(texts: string | string[], options?: EmbedOptions): Promise<number[][]> {
    const input = Array.isArray(texts) ? texts : [texts]
    if (input.length === 0) return []

    if (embeddingProvider() === "gemini") {
      return embedGemini(input, options)
    }

    const pipe = await embeddingPipeline()
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

  async function embedGemini(texts: string[], options?: EmbedOptions): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Gemini embeddings requested but GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Set OPENCODE_SEMANTIC_EMBEDDINGS=local to force local embeddings.",
      )
    }

    const model = process.env.OPENCODE_GEMINI_EMBED_MODEL || "gemini-embedding-001"
    const outputDimensionality = Number(process.env.OPENCODE_GEMINI_EMBED_DIM || options?.outputDimensionality || 768)
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

    const { tokenizer, model } = await rerankerPipeline()
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
    if (embeddingProvider() === "gemini") {
      const dim = Number(process.env.OPENCODE_GEMINI_EMBED_DIM || 768)
      return Number.isFinite(dim) && dim > 0 ? dim : 768
    }

    // Supabase/gte-small has 384 dimensions
    return 384
  }

  /**
   * Get current embeddings provider ("local" or "gemini")
   */
  export function getProvider(): string {
    return embeddingProvider()
  }

  /**
   * Preload models (call during initialization)
   */
  export async function preload(): Promise<void> {
    log.info("preloading models (HuggingFace transformers v3)")
    // Only preload the local embedding model if we're actually using it.
    await Promise.all([embeddingProvider() === "local" ? embeddingPipeline() : Promise.resolve(), rerankerPipeline()])
    log.info("models preloaded")
  }

  /**
   * Get the current device being used
   */
  export async function getDevice(): Promise<string> {
    const { device } = await getTransformers()
    return device
  }
}
