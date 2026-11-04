import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Global } from "../global/index.js"
import { validateRepositoryId } from "../semantic/source-manifest.js"

async function location(root: string): Promise<{ root: string; file: string }> {
  const canonical = await fs.realpath(root)
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical
  const hash = createHash("sha256").update(key).digest("hex")
  return { root: key, file: path.join(Global.Path.data, "repository-bindings", `${hash}.json`) }
}

export async function readRepositoryId(root: string): Promise<string | undefined> {
  const binding = await location(root)
  let text: string
  try { text = await fs.readFile(binding.file, "utf8") }
  catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error }
  const data = JSON.parse(text)
  if (!data || data.version !== 1 || data.root !== binding.root || typeof data.repositoryId !== "string") throw new Error("Invalid repository binding")
  validateRepositoryId(data.repositoryId)
  return data.repositoryId
}

/** Explicitly bind this checkout to a repository UUID. Existing bindings cannot be changed. */
export async function registerRepository(root: string, repositoryId: string): Promise<void> {
  validateRepositoryId(repositoryId)
  const binding = await location(root)
  await fs.mkdir(path.dirname(binding.file), { recursive: true, mode: 0o700 })
  const temporary = `${binding.file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, root: binding.root, repositoryId }), { flag: "wx", mode: 0o600 })
    try { await fs.link(temporary, binding.file) }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error
      if (await readRepositoryId(root) !== repositoryId) throw new Error("Checkout already has a different repository identity")
    }
  } finally { await fs.unlink(temporary).catch(() => {}) }
}
