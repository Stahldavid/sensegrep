// Local, sequential comparison. Does not change global config or the default index.
// node scripts/benchmark-chunk-policy.mjs ROOT TOKENIZER CASES_JSON OUTPUT_DIRECTORY
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve, join } from "node:path"

const [root, tokenizer, casesFile, output] = process.argv.slice(2)
if (!root || !tokenizer || !casesFile || !output) throw new Error("Expected ROOT TOKENIZER CASES_JSON OUTPUT_DIRECTORY")
mkdirSync(output, { recursive: true })
const cli = fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url))
const cases = JSON.parse(readFileSync(casesFile, "utf8").replace(/^\uFEFF/, ""))
const results = []
for (const [name, target, preserve] of [["compact", 1024, 2048], ["balanced", 2048, 4096], ["large", 4096, 4096]]) {
  const profile = `chunk-benchmark-${name}`
  const env = { ...process.env, SENSEGREP_PROVIDER: "ollama", SENSEGREP_EMBED_MODEL: "qwen3-embedding:0.6b", SENSEGREP_EMBED_DIM: "1024", SENSEGREP_OLLAMA_BASE_URL: "http://127.0.0.1:11434", SENSEGREP_TOKENIZER_PATH: resolve(tokenizer), SENSEGREP_CONTEXT_TOKENS: "8192", SENSEGREP_CHUNK_TARGET_TOKENS: String(target), SENSEGREP_CHUNK_PRESERVE_TOKENS: String(preserve), SENSEGREP_CHUNK_MAX_TOKENS: "7000", SENSEGREP_CHUNK_OVERLAP_TOKENS: "128", SENSEGREP_BATCH_TOKENS: "16384", SENSEGREP_QUERY_CACHE: "false" }
  const run = (label, args) => {
    const start = performance.now()
    const processResult = spawnSync(process.execPath, [cli, ...args, "--root", resolve(root), "--profile", profile, "--json"], { env, encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024 })
    writeFileSync(join(output, `${name}-${label}.log`), processResult.stderr ?? "")
    writeFileSync(join(output, `${name}-${label}.json`), processResult.stdout ?? "")
    if (processResult.status !== 0) throw new Error(`${name}/${label} failed: ${processResult.error ?? processResult.stderr}`)
    return { wallMs: Math.round(performance.now() - start), data: JSON.parse(processResult.stdout) }
  }
  console.log(`Starting ${name}: target=${target}, preserve=${preserve}, profile=${profile}`)
  const indexed = run("index", ["index", "--full", "--no-watch"])
  console.log(`${name} index: ${indexed.wallMs}ms`)
  const searches = []
  for (const test of cases) {
    const result = run(test.name, ["search", test.query, "--limit", "5", "--max-per-file", "1"])
    searches.push({ name: test.name, wallMs: result.wallMs, rank: result.data.results.findIndex((row) => row.file === test.expected) + 1 })
  }
  results.push({ name, target, preserve, profile, index: indexed, searches })
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ name, searches }))
}
