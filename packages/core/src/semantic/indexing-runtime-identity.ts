import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { isDeepStrictEqual } from "node:util"
import { loadConfig } from "../config/loader.js"
import { Instance } from "../project/instance.js"
import { getAllLanguages, getLanguageForFile } from "./language/registry.js"
import { TypeScriptLanguage, JavaScriptLanguage } from "./language/typescript.js"
import { PythonLanguage, chunk as chunkPython } from "./language/python.js"
import { JavaLanguage, chunk as chunkJava } from "./language/java.js"
import { VueLanguage, chunk as chunkVue } from "./language/vue.js"

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const WASMS = ["typescript", "tsx", "javascript", "python", "java", "vue"]
const require = createRequire(import.meta.url)

function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshot)
  if (value instanceof Set) return new Set([...value].map(snapshot))
  if (value instanceof Map) return new Map([...value].map(([key, child]) => [snapshot(key), snapshot(child)]))
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)]))
  return value
}
const expectedLanguages = [TypeScriptLanguage, JavaScriptLanguage, { ...PythonLanguage, chunk: chunkPython }, { ...JavaLanguage, chunk: chunkJava }, { ...VueLanguage, chunk: chunkVue }].map(language => ({ id: language.id, descriptor: snapshot(language), extensions: [...language.extensions] }))

function knownRegistry(): boolean {
  const languages = getAllLanguages()
  if (languages.length !== expectedLanguages.length) return false
  for (const expected of expectedLanguages) {
    if (!isDeepStrictEqual(languages.find(language => language.id === expected.id), expected.descriptor)) return false
    for (const extension of expected.extensions) {
      const normalized = extension.startsWith(".") ? extension : `.${extension}`
      if (getLanguageForFile(`fixture${normalized}`)?.id !== expected.id) return false
    }
  }
  return true
}

async function stableFile(filename: string): Promise<Buffer> {
  const before = await fs.stat(filename)
  if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error("Runtime identity file unavailable or too large")
  const handle = await fs.open(filename, "r")
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error("Runtime artifact changed before reading")
    const buffer = Buffer.allocUnsafe(opened.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await handle.stat()
    if (offset !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Runtime artifact changed while reading")
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

async function runtimeFiles(root: string, extension: ".ts" | ".js", relative = ""): Promise<Array<{ name: string; filename: string }>> {
  const results: Array<{ name: string; filename: string }> = []
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error("Unexpected link in runtime artifacts")
    if (entry.isDirectory()) results.push(...await runtimeFiles(root, extension, name))
    else if (entry.isFile() && entry.name.endsWith(extension) && !/\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith(".d.ts")) results.push({ name: `core/${name}`, filename: path.join(root, name) })
  }
  return results
}

/**
 * Fingerprint local indexing implementation artifacts and installed parser/tokenizer
 * binaries. It is not provider revision identity. Runtime artifacts must remain
 * immutable while the process runs. Source and dist deliberately have distinct IDs.
 * Unknown plugin code, incomplete layouts, and bundled layouts fail closed.
 */
export async function getIndexingRuntimeIdentity(): Promise<string | undefined> {
  try {
    const filename = fileURLToPath(import.meta.url)
    const semanticDirectory = path.dirname(filename)
    const runtimeRoot = path.dirname(semanticDirectory)
    const extension = filename.endsWith(".ts") ? ".ts" : filename.endsWith(".js") ? ".js" : undefined
    if (!extension || path.basename(semanticDirectory) !== "semantic" || path.basename(runtimeRoot) !== (extension === ".ts" ? "src" : "dist") || path.basename(filename) !== `indexing-runtime-identity${extension}`) return undefined
    const packageFile = path.join(runtimeRoot, "..", "package.json")
    const packageBytes = await stableFile(packageFile)
    if (JSON.parse(packageBytes.toString("utf8")).name !== "@sensegrep/core") return undefined
    if (process.env.SENSEGREP_LANGUAGE_PLUGINS?.split(",").some(value => value.trim()) || (loadConfig(Instance.directory).languagePlugins?.length ?? 0) > 0 || !knownRegistry()) return undefined
    const files = await runtimeFiles(runtimeRoot, extension)
    if (!files.some(file => file.name === `core/semantic/indexer${extension}`) || !files.some(file => file.name === `core/semantic/chunking${extension}`) || !files.some(file => file.name === `core/semantic/embeddings-remote${extension}`)) return undefined
    files.push({ name: "core/package.json", filename: packageFile })
    files.push({ name: "parser/web-tree-sitter.js", filename: require.resolve("web-tree-sitter") })
    files.push({ name: "parser/tree-sitter.wasm", filename: require.resolve("web-tree-sitter/tree-sitter.wasm") })
    for (const language of WASMS) files.push({ name: `parser/tree-sitter-${language}.wasm`, filename: require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`) })
    const tokenizerCjs = require.resolve("@huggingface/tokenizers")
    files.push({ name: "tokenizer/tokenizers.cjs", filename: tokenizerCjs })
    files.push({ name: "tokenizer/tokenizers.mjs", filename: path.join(path.dirname(tokenizerCjs), "tokenizers.mjs") })
    files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    const hash = createHash("sha256")
    hash.update(JSON.stringify({ version: 1, scope: "local-indexing-artifacts", node: process.version, representation: extension, registry: expectedLanguages.map(language => language.id).sort() }))
    let totalBytes = 0
    for (const file of files) {
      const bytes = await stableFile(file.filename)
      totalBytes += bytes.length
      if (totalBytes > MAX_TOTAL_BYTES) return undefined
      hash.update(JSON.stringify([file.name, bytes.length, createHash("sha256").update(bytes).digest("hex")]))
    }
    return `sha256:${hash.digest("hex")}`
  } catch { return undefined }
}
