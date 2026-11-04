import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../global/index.js"
import { Instance } from "../project/instance.js"
import { sharedRepositoryScope } from "../project/repository-sharing.js"

/** A deliberately opt-in cache. The caller supplies the exact adapter input and
 * an explicit model revision and account scope, never credentials. */
export namespace DocumentEmbeddingCache {
  export type Identity = { revision: string; accountScope: string; provider: string; model: string; endpoint: string; dimension: number; taskType: string; input: string; title?: string; transform: string }
  const VERSION = 1
  function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") }
  function valid(value: unknown, dimension: number): value is number[] {
    return Array.isArray(value) && value.length === dimension && value.every(n => typeof n === "number" && Number.isFinite(n))
  }
  async function directory(): Promise<string> {
    const repository = await sharedRepositoryScope(Instance.directory)
    if (repository) return path.join(Global.Path.cache, "document-embeddings-v1", `repository-${digest([repository, Instance.profile])}`)
    // Unregistered and non-opted-in checkouts retain their private scope.
    return path.join(Global.Path.cache, "document-embeddings-v1", digest([Instance.directory, Instance.profile]))
  }
  function enabled(): { revision: string; accountScope: string } | undefined {
    const revision = process.env.SENSEGREP_DOCUMENT_CACHE_REVISION?.trim()
    const accountScope = process.env.SENSEGREP_DOCUMENT_CACHE_ACCOUNT?.trim()
    return revision && accountScope ? { revision, accountScope } : undefined
  }
  export function configuration() { return enabled() }

  /** Serializes misses across processes. A crashed owner leaves a guard behind,
   * requiring operator recovery instead of allowing duplicate provider calls. */
  export async function getOrCompute(
    identities: Identity[], compute: (missingIndices: number[]) => Promise<number[][]>, signal?: AbortSignal,
  ): Promise<number[][]> {
    if (!identities.length) return []
    const dir = await directory()
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const guard = path.join(dir, ".guard")
    const deadline = Date.now() + 30_000
    while (true) {
      signal?.throwIfAborted()
      try { await fs.mkdir(guard, { mode: 0o700 }); break }
      catch (error: any) {
        if (error?.code !== "EEXIST") throw error
        if (Date.now() >= deadline) throw new Error(`Document embedding cache is busy or abandoned at ${guard}; stop all users before inspecting and removing the guard.`)
        await new Promise<void>((resolve, reject) => {
          const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve() }
          const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new Error("Aborted")) }
          const timer = setTimeout(finish, 50)
          signal?.addEventListener("abort", abort, { once: true })
          if (signal?.aborted) abort()
        })
      }
    }
    try {
      const keys = identities.map(identity => digest([VERSION, identity]))
      const vectors: Array<number[] | undefined> = new Array(keys.length)
      const misses: number[] = []
      // Duplicate misses share a provider request within a batch.
      const first = new Map<string, number>()
      for (let i = 0; i < keys.length; i++) {
        const earlier = first.get(keys[i])
        if (earlier !== undefined) continue
        first.set(keys[i], i)
        try {
          const entry = JSON.parse(await fs.readFile(path.join(dir, `${keys[i]}.json`), "utf8"))
          if (entry.version === VERSION && valid(entry.vector, identities[i].dimension)) vectors[i] = entry.vector
          else misses.push(i)
        } catch { misses.push(i) }
      }
      if (misses.length) {
        signal?.throwIfAborted()
        const computed = await compute(misses)
        signal?.throwIfAborted()
        if (computed.length !== misses.length || computed.some((v, i) => !valid(v, identities[misses[i]].dimension))) throw new Error("Invalid document embedding cache result")
        for (let i = 0; i < misses.length; i++) {
          const index = misses[i]
          vectors[index] = computed[i]
          const target = path.join(dir, `${keys[index]}.json`)
          const temp = `${target}.${crypto.randomUUID()}.tmp`
          try {
            await fs.writeFile(temp, JSON.stringify({ version: VERSION, vector: computed[i] }), { flag: "wx", mode: 0o600 })
            await fs.rename(temp, target)
          } finally { await fs.rm(temp, { force: true }) }
        }
      }
      for (let i = 0; i < keys.length; i++) vectors[i] ??= vectors[first.get(keys[i])!]
      const entries = (await fs.readdir(dir)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      if (entries.length > 2000) {
        const times = await Promise.all(entries.map(async name => ({ name, time: (await fs.stat(path.join(dir, name))).mtimeMs })))
        times.sort((a, b) => b.time - a.time)
        await Promise.all(times.slice(2000).map(({ name }) => fs.rm(path.join(dir, name), { force: true })))
      }
      signal?.throwIfAborted()
      return vectors as number[][]
    } finally { await fs.rmdir(guard) }
  }
}
