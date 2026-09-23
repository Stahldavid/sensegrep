import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { Tokenizer } from "@huggingface/tokenizers"
import { getEmbeddingConfig, type EmbeddingConfig } from "./embedding-config.js"

const counters = new Map<string, { stamp: string; digest: string; tokenizer: Tokenizer }>()

function load(config: EmbeddingConfig) {
  if (!config.tokenizerPath) return undefined
  const filename = path.resolve(config.tokenizerPath)
  const stat = fs.statSync(filename)
  const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  let entry = counters.get(filename)
  if (!entry || entry.stamp !== stamp) {
    const raw = fs.readFileSync(filename, "utf8")
    entry = { stamp, digest: createHash("sha256").update(raw).digest("hex"), tokenizer: new Tokenizer(JSON.parse(raw), {}) }
    counters.set(filename, entry)
  }
  return entry
}

/** Local tokenizer identity participates in index invalidation, without leaking its path. */
export function tokenCounterIdentity(config = getEmbeddingConfig()): string {
  const entry = load(config)
  return entry ? `huggingface:${entry.digest}` : "estimate:utf8-div3:v1"
}

/** Count full embedding input. The fallback is an estimate, never a truncation license. */
export function countEmbeddingTokens(text: string, config = getEmbeddingConfig()): number {
  const entry = load(config)
  return entry
    ? entry.tokenizer.encode(text, { add_special_tokens: true }).ids.length
    : Math.ceil(Buffer.byteLength(text, "utf8") / 3)
}

/** Largest fitting Unicode-safe prefix, with a final measurement (BPE is not strictly monotonic). */
export function fittingPrefix(text: string, budget: number, config = getEmbeddingConfig()): string {
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (countEmbeddingTokens(text.slice(0, mid), config) <= budget) low = mid
    else high = mid - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low--
  let prefix = text.slice(0, low)
  while (prefix && countEmbeddingTokens(prefix, config) > budget) {
    prefix = prefix.slice(0, /[\uDC00-\uDFFF]/.test(prefix[prefix.length - 1]) ? -2 : -1)
  }
  return prefix
}
