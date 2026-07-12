import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../global/index.js"
import type { EmbeddingConfig } from "./embedding-config.js"

const CACHE_VERSION = 1
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60_000
const DEFAULT_MAX_ENTRIES = 2_000
let prunePromise: Promise<void> | undefined

type CacheIdentity = {
  text: string
  taskType?: string
  outputDimensionality?: number
  config: EmbeddingConfig
}

type CacheEntry = {
  version: number
  createdAt: number
  dimension: number
  vector: number[]
}

function enabled(): boolean {
  if (process.env.NODE_ENV === "test" && process.env.SENSEGREP_QUERY_CACHE === undefined) return false
  return !["0", "false", "off", "no"].includes(String(process.env.SENSEGREP_QUERY_CACHE ?? "true").toLowerCase())
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function cacheDirectory(): string {
  return process.env.SENSEGREP_QUERY_CACHE_DIR || path.join(Global.Path.cache, "query-embeddings-v1")
}

function identityKey(identity: CacheIdentity): string {
  const config = identity.config
  return crypto.createHash("sha256").update(JSON.stringify({
    version: CACHE_VERSION,
    provider: config.provider,
    model: config.embedModel,
    dimension: identity.outputDimensionality ?? config.embedDim,
    baseUrl: config.baseUrl,
    region: config.region,
    maxInputTokens: config.maxInputTokens,
    taskType: identity.taskType,
    text: identity.text,
  })).digest("hex")
}

function entryPath(identity: CacheIdentity): string {
  return path.join(cacheDirectory(), `${identityKey(identity)}.json`)
}

function isValidVector(value: unknown, dimension: number): value is number[] {
  return Array.isArray(value)
    && value.length === dimension
    && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

async function pruneCache(): Promise<void> {
  const directory = cacheDirectory()
  const maxEntries = positiveEnv("SENSEGREP_QUERY_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES)
  const names = (await fs.readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".json"))
  if (names.length <= maxEntries) return
  const entries = await Promise.all(names.map(async (name) => ({
    name,
    stat: await fs.stat(path.join(directory, name)).catch(() => undefined),
  })))
  entries.sort((left, right) => (right.stat?.mtimeMs ?? 0) - (left.stat?.mtimeMs ?? 0))
  await Promise.all(entries.slice(maxEntries).map(({ name }) => fs.rm(path.join(directory, name), { force: true })))
}

export namespace QueryEmbeddingCache {
  export async function get(identity: CacheIdentity): Promise<number[] | undefined> {
    if (!enabled()) return undefined
    const filepath = entryPath(identity)
    try {
      const entry = JSON.parse(await fs.readFile(filepath, "utf8")) as CacheEntry
      const dimension = identity.outputDimensionality ?? identity.config.embedDim
      const ttlMs = positiveEnv("SENSEGREP_QUERY_CACHE_TTL_MS", DEFAULT_TTL_MS)
      if (entry.version !== CACHE_VERSION || Date.now() - entry.createdAt > ttlMs || !isValidVector(entry.vector, dimension)) {
        await fs.rm(filepath, { force: true })
        return undefined
      }
      return entry.vector
    } catch {
      return undefined
    }
  }

  export async function set(identity: CacheIdentity, vector: number[]): Promise<void> {
    if (!enabled()) return
    const dimension = identity.outputDimensionality ?? identity.config.embedDim
    if (!isValidVector(vector, dimension)) return
    const directory = cacheDirectory()
    await fs.mkdir(directory, { recursive: true })
    const filepath = entryPath(identity)
    const temporaryPath = `${filepath}.${process.pid}.${crypto.randomUUID()}.tmp`
    const entry: CacheEntry = { version: CACHE_VERSION, createdAt: Date.now(), dimension, vector }
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(entry), { encoding: "utf8", flag: "wx" })
      await fs.rm(filepath, { force: true })
      await fs.rename(temporaryPath, filepath)
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    }
    prunePromise ??= pruneCache().finally(() => { prunePromise = undefined })
    await prunePromise
  }
}
