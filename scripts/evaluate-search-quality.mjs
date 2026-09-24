// Compare two built CLIs against the same existing index. Does not index or install.
// node scripts/evaluate-search-quality.mjs --root <repo> --baseline <main.js> --cases <cases.json> --output <directory>
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const flags = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) =>
  [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]))
for (const flag of ['root', 'baseline', 'cases', 'output']) if (!flags[flag]) throw new Error(`Missing --${flag}`)
const root = path.resolve(flags.root)
const output = path.resolve(flags.output)
const candidate = path.resolve(flags.candidate ?? fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url)))
const cases = JSON.parse(readFileSync(flags.cases, 'utf8'))
mkdirSync(output, { recursive: true })
const rows = []
const warmed = new Set()
const invoke = (cli, args) => {
  const start = performance.now()
  const p = spawnSync(process.execPath, [cli, ...args, '--root', root, '--json', '--log-format', 'none'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(flags.cache === 'off' ? { SENSEGREP_QUERY_CACHE: 'false' } : {}) },
  })
  if (p.status !== 0) throw new Error(`CLI failed: ${p.error?.message ?? p.stderr ?? p.status}`)
  return { data: JSON.parse(p.stdout), ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(p.stdout) }
}
const initialIndex = invoke(candidate, ['verify', '--strict']).data
for (let i = 0; i < cases.length; i++) {
  const c = cases[i]
  const row = { name: c.name, expected: c.expected, symbol: c.symbol, negative: c.negative, budget: c.budget }
  // Alternate order to reduce systematic timing bias. A warmup makes cache mode explicit.
  if (flags.cache !== 'off' && flags.cache !== 'reuse' && !warmed.has(c.query)) {
    invoke(candidate, ['search', c.query, '--limit', '1'])
    warmed.add(c.query)
  }
  const variants = [['baseline', path.resolve(flags.baseline)], ['candidate', candidate]]
  if (i % 2) variants.reverse()
  for (const [variant, cli] of variants) {
    const { data, ms, bytes } = invoke(cli, c.args ?? ['search', c.query, '--limit', '10', '--diagnostic'])
    const results = data.results ?? []
    if (c.budget && (data.budget?.usedTokens > c.budget || (data.budget?.maxBytes && bytes > data.budget.maxBytes)))
      throw new Error(`Output budget exceeded for ${c.name}`)
    row[variant] = {
      ms, bytes, snapshot: data.diagnostic?.index?.snapshotId ?? data.index?.snapshotId, fileRank: c.expected ? results.findIndex((r) => r.file === c.expected) + 1 : null,
      symbolRank: c.symbol ? results.findIndex((r) => r.file === c.expected && r.symbol === c.symbol) + 1 : null,
      sufficiency: data.answerSufficiency, budget: data.budget, metrics: data.diagnostic?.metrics,
      symbols: results.map((r) => `${r.file}:${r.symbol ?? ''}`),
    }
    writeFileSync(path.join(output, `${i}-${variant}.json`), JSON.stringify({ case: c, data, ms, bytes }, null, 2))
  }
  if (!row.baseline.snapshot || !row.candidate.snapshot) throw new Error('Snapshot evidence missing; use --diagnostic in case args')
  if (row.baseline.snapshot !== row.candidate.snapshot) throw new Error('Index snapshot changed during comparison')
  if (row.candidate.snapshot !== initialIndex.snapshotId) throw new Error('Index snapshot changed since preflight')
  rows.push(row)
  writeFileSync(path.join(output, 'summary.json'), JSON.stringify(rows, null, 2))
  console.log(JSON.stringify({ name: c.name, before: row.baseline.symbolRank ?? row.baseline.fileRank, after: row.candidate.symbolRank ?? row.candidate.fileRank }))
}
const finalIndex = invoke(candidate, ['verify', '--strict']).data
if (finalIndex.snapshotId !== initialIndex.snapshotId) throw new Error('Index changed before final verification')
const searches = rows.filter((r) => !r.budget && r.expected)
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1]
const totals = Object.fromEntries(['baseline', 'candidate'].map((variant) => [variant, {
  searches: searches.length,
  fileTop5: searches.filter((r) => r[variant].fileRank > 0 && r[variant].fileRank <= 5).length,
  symbolCases: searches.filter((r) => r.symbol).length,
  symbolTop5: searches.filter((r) => r.symbol && r[variant].symbolRank > 0 && r[variant].symbolRank <= 5).length,
  medianMs: quantile(searches.map((r) => r[variant].ms), 0.5), p95Ms: quantile(searches.map((r) => r[variant].ms), 0.95),
  falseWeakWarnings: searches.filter((r) => r[variant].sufficiency === 'weak-evidence').length,
  negativesFlagged: rows.filter((r) => r.negative && r[variant].sufficiency === 'weak-evidence').length,
}]))
writeFileSync(path.join(output, 'totals.json'), JSON.stringify({ cache: flags.cache === 'off' ? 'disabled' : flags.cache === 'reuse' ? 'existing' : 'warmed', totals }, null, 2))
console.log(JSON.stringify(totals))
