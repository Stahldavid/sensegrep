import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import { evaluateWithJev, jevResultKey } from "./jev.js"
import { evidenceKey, type EvidenceAspect } from "./jev-coverage.js"
import { estimateResultTokens, type WorkingResult } from "./sensegrep-pipeline.js"

/** Optional extraction from oversized symbols. Output remains explicitly partial source. */
export async function selectJevBlocks(query: string, rows: WorkingResult[], budget: number, aspects: EvidenceAspect[],
  timeoutMs: number, signal?: AbortSignal, dependencies?: Parameters<typeof evaluateWithJev>[3], batchSize?: number) {
  const started = Date.now()
  const candidates: WorkingResult[] = []
  const bundles = new Map<string, { original: WorkingResult; mandatory: WorkingResult[]; optional: WorkingResult[] }>()
  for (const original of rows.slice(0, 3)) {
    if (original.contentTruncated || estimateResultTokens(original) <= budget) continue
    const blocks = await TreeSitterChunking.evidenceBlocks(original.content, original.file)
    if (!blocks.length) continue
    const lines = original.content.split(/\r?\n/)
    const parts = blocks.map(b => ({ ...original, content: lines.slice(b.startLine - 1, b.endLine).join("\n"),
      startLine: original.startLine + b.startLine - 1, endLine: original.startLine + b.endLine - 1,
      contentTruncated: true, jev: undefined,
      whyMatched: [...(original.whyMatched ?? []), `AST excerpt of ${evidenceKey(original)}; enclosing function incomplete`] }))
    const mandatory = parts.filter((_, i) => blocks[i].guard || blocks[i].signature)
    if (mandatory.reduce((s, r) => s + estimateResultTokens(r), 0) >= budget) continue
    const optional = parts.filter((_, i) => !blocks[i].guard && !blocks[i].signature)
    bundles.set(evidenceKey(original), { original, mandatory, optional })
    candidates.push(...optional)
  }
  if (!candidates.length) return { results: rows, diagnostics: undefined }
  const evaluated = await evaluateWithJev(query, candidates, { mode: "evidence", aspects, batchSize, candidates: 80, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)), signal }, dependencies)
  if (evaluated.diagnostics.status !== "complete") return { results: rows, diagnostics: evaluated.diagnostics }
  const replacements = new Map<string, WorkingResult[]>()
  for (const [key, bundle] of bundles) {
    const chosen = bundle.optional.filter(r => (evaluated.scores.get(jevResultKey(r))?.evidence ?? 0) >= 0.8)
    const parts = [...bundle.mandatory, ...chosen].sort((a,b) => a.startLine - b.startLine)
    if (!chosen.length || parts.reduce((s,r) => s + estimateResultTokens(r),0) > budget) continue
    // Keep all guard/signature blocks together as one candidate; gaps are explicit.
    replacements.set(key, [{ ...bundle.original, contentTruncated: true, metadata: {...bundle.original.metadata, snippetIntegrity: "partial"},
      content: parts.map(r => `// source lines ${r.startLine}-${r.endLine}\n${r.content}`).join("\n/* omitted source */\n"),
      whyMatched: [...(bundle.original.whyMatched ?? []), "AST excerpts; signatures and guards retained; function incomplete"] }])
  }
  return { results: rows.flatMap(r => replacements.get(evidenceKey(r)) ?? [r]), diagnostics: evaluated.diagnostics }
}
