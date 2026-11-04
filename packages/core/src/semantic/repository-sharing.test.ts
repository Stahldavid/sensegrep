import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, expect, it, vi } from "vitest"
import { Instance } from "../project/instance.js"
import { registerRepository } from "../project/repository-identity.js"
import { sharedRepositoryScope, sharedSourceDirectory } from "../project/repository-sharing.js"
import { DocumentEmbeddingCache } from "./document-embedding-cache.js"
import { linkSharedSourceObjects, readSourceObject, writeSourceObject } from "./source-object-store.js"

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sensegrep-repository-sharing-"))
afterAll(() => fs.rm(temporary, { recursive: true, force: true }))
afterEach(() => vi.unstubAllEnvs())
const repositoryA = "da61d35b-4a1b-4d1d-a180-95beae51f1af"
const repositoryB = "86d66cfa-55aa-46f2-876b-780d71cab6ec"

async function checkout(name: string, repository?: string) {
  const root = path.join(temporary, name)
  await fs.mkdir(root)
  if (repository) await registerRepository(root, repository)
  return root
}

it("shares immutable source bytes through hardlinks only within an opted-in repository", async () => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const a = await checkout("source-a", repositoryA), b = await checkout("source-b", repositoryA), c = await checkout("source-c", repositoryB)
  const bytes = Buffer.from("\ufeffconst source = 1\r\n")
  const store = (root: string) => Instance.provide({ directory: root, fn: () => writeSourceObject(path.join(root, "index"), bytes) })
  const hash = await store(a)
  expect(await linkSharedSourceObjects(path.join(b, "index"), b, { "a.ts": { sourceSha256: hash, sourceHashKind: "sha256-raw-v1" } })).toEqual({ linked: 1, unavailable: 0 })
  await store(c)
  const file = (root: string) => path.join(root, "index", ".source-objects", "sha256", hash)
  const [one, two, other, shared] = await Promise.all([fs.stat(file(a)), fs.stat(file(b)), fs.stat(file(c)), fs.stat(path.join(sharedSourceDirectory(repositoryA), hash))])
  expect([one.dev, one.ino]).toEqual([two.dev, two.ino])
  expect([one.dev, one.ino]).toEqual([shared.dev, shared.ino])
  expect([one.dev, one.ino]).not.toEqual([other.dev, other.ino])
  await fs.rm(path.join(a, "index"), { recursive: true })
  expect(await readSourceObject(path.join(b, "index"), hash)).toEqual(bytes)
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "0")
  const privateRoot = await checkout("source-private", repositoryA)
  await store(privateRoot)
  const privateStat = await fs.stat(file(privateRoot))
  expect([privateStat.dev, privateStat.ino]).not.toEqual([shared.dev, shared.ino])
})

it("reuses exact embedding inputs across opted-in roots and separates repository, profile and effective identity", async () => {
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "1")
  const a = await checkout("cache-a", repositoryA), b = await checkout("cache-b", repositoryA), c = await checkout("cache-c", repositoryB), unregistered = await checkout("cache-unregistered")
  const identity: DocumentEmbeddingCache.Identity = { revision: "revision", accountScope: "account", provider: "openai", model: "model", endpoint: "http://127.0.0.1:1234", dimension: 2, taskType: "document", input: "same", transform: "v1" }
  const compute = vi.fn(async () => [[1, 0]])
  const run = (root: string, value = identity, profile = "default") => Instance.provide({ directory: root, profile, fn: () => DocumentEmbeddingCache.getOrCompute([value], compute) })
  await run(a); await run(b)
  expect(compute).toHaveBeenCalledTimes(1)
  await run(c); await run(unregistered)
  expect(compute).toHaveBeenCalledTimes(3)
  await run(b, { ...identity, accountScope: "other-account" })
  await run(b, { ...identity, transform: "v2" })
  await run(b, identity, "private-profile")
  expect(compute).toHaveBeenCalledTimes(6)
  vi.stubEnv("SENSEGREP_SHARED_OBJECTS", "0")
  await run(b)
  expect(compute).toHaveBeenCalledTimes(7)
  expect(await sharedRepositoryScope(unregistered)).toBeUndefined()
})
