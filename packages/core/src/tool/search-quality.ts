import type { WorkingResult } from "./sensegrep-pipeline.js"

// These signals rank evidence; they never assert that an answer is correct.
const STOP = new Set("a an the and or of to in on for with from by is are be can does do how where when what which before after even if than below above code function implementation logic old qual quais como onde quando para por com uma um que os as de da do dos das em no na nao se ser".split(" "))
export function evidenceTerms(text: string): string[] {
  const words = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []
  return [...new Set(words.filter((word) => word.length > 2 && !STOP.has(word)).map((word) =>
    word.length > 5 ? word.replace(/(?:ing|ed|s)$/, "") : word))]
}

export function implementationIntent(query: string): boolean {
  return /\b(when|how|where|ensure|prevent|apply|validate|quando|como|onde|garantir|impedir|validar)\b/i.test(query)
    && !/\b(value|constant|default|configured|constante|padrao)\b/i.test(query)
}

function executable(result: WorkingResult): boolean {
  return ["function", "method"].includes(String(result.metadata.symbolType))
    || /=>|\bfunction\b/.test(result.content)
}

function mentions(source: WorkingResult, target: WorkingResult): boolean {
  const name = String(target.metadata.symbolName ?? "")
  return name.length > 3 && /^[\w$]+$/.test(name)
    && new RegExp(`(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`).test(source.content)
}

export function evidenceUtility(query: string, result: WorkingResult): number {
  if (!implementationIntent(query) || result.semanticScore > 1) return 0
  const tokens = evidenceTerms(query)
  const body = new Set(evidenceTerms(`${result.metadata.symbolName ?? ""} ${result.content}`))
  const coverage = tokens.filter((token) => body.has(token)).length / Math.max(1, tokens.length)
  if (executable(result)) return Math.min(0.12, coverage * 0.2)
  return ["variable", "constant"].includes(String(result.metadata.symbolType)) ? -0.06 : 0
}

export function rankEvidence(query: string, results: WorkingResult[]): WorkingResult[] {
  const anchors = results.slice(0, 5).filter((r) => !executable(r) && ["variable", "constant"].includes(String(r.metadata.symbolType)))
  const originalBest = new Map<string, number>()
  for (const r of results) originalBest.set(r.file, Math.max(originalBest.get(r.file) ?? 0, r.rerankScore ?? r.semanticScore))
  const adjusted = results.map((r) => {
    if (r.semanticScore > 1) return r
    const ruleReference = implementationIntent(query) && executable(r) && anchors.some((a) => a.file === r.file && mentions(r, a)) ? 0.1 : 0
    const adjustment = ruleReference ? Math.max(evidenceUtility(query, r), ruleReference) : evidenceUtility(query, r)
    return adjustment === 0 ? r : { ...r, rerankScore: Math.max(0, Math.min(1, (r.rerankScore ?? r.semanticScore) + adjustment)),
      whyMatched: [...(r.whyMatched ?? []), `implementation evidence adjustment: ${adjustment.toFixed(3)}`] }
  })
  const adjustedBest = new Map<string, number>()
  for (const r of adjusted) adjustedBest.set(r.file, Math.max(adjustedBest.get(r.file) ?? 0, r.rerankScore ?? r.semanticScore))
  // Change which symbol represents a file without demoting the entire file:
  // vocabulary-rich UI wrappers must not displace a relevant policy module.
  return adjusted.map((r) => {
    const original = originalBest.get(r.file)!
    const shift = original - adjustedBest.get(r.file)!
    return shift === 0 || original > 1 ? r : { ...r, rerankScore: Math.max(0, (r.rerankScore ?? r.semanticScore) + shift) }
  }).sort((a, b) => (b.rerankScore ?? b.semanticScore) - (a.rerankScore ?? a.semanticScore))
}

/** One primary result plus at most one distinct, relevant, complementary symbol. */
export function flexibleDiversity(results: WorkingResult[], query: string, maxPerSymbol = 2): WorkingResult[] {
  const kept: WorkingResult[] = []
  const complements: WorkingResult[] = []
  const files = new Map<string, WorkingResult[]>()
  const symbols = new Map<string, number>()
  const terms = evidenceTerms(query)
  for (const r of results) {
    const name = String(r.metadata.symbolName ?? "")
    const siblings = files.get(r.file) ?? []
    if (maxPerSymbol > 0 && name && (symbols.get(name) ?? 0) >= maxPerSymbol) continue
    if (siblings.length) {
      const first = siblings[0]
      if (siblings.length >= 2 || !name || name === first.metadata.symbolName) continue
      if (first.startLine <= r.endLine && r.startLine <= first.endLine) continue
      const relevant = evidenceTerms(`${name} ${r.content}`).filter((term) => terms.includes(term)).length >= 2
      const firstTerms = new Set(evidenceTerms(String(first.metadata.symbolName ?? "")))
      const addsFacet = executable(first) && executable(r)
        && evidenceTerms(name).some((term) => terms.includes(term) && !firstTerms.has(term))
      const related = mentions(first, r) || mentions(r, first) || addsFacet
      if (["type", "interface", "enum"].includes(String(r.metadata.symbolType))
        && !/\b(type|interface|schema|contract|tipo|contrato)\b/i.test(query)) continue
      const suppliesMissingAspect = Object.entries(r.jev?.aspects ?? {}).some(([id, support]) => support >= 0.8 && (first.jev?.aspects?.[id] ?? 0) < 0.65)
      if (!suppliesMissingAspect && (!relevant || !related || (r.rerankScore ?? r.semanticScore) < (first.rerankScore ?? first.semanticScore) * 0.7)) continue
    }
    siblings.push(r)
    files.set(r.file, siblings)
    if (name) symbols.set(name, (symbols.get(name) ?? 0) + 1)
    if (siblings.length === 1) kept.push(r)
    else complements.push(r)
  }
  // Preserve the first five file anchors. Context selection still sees all complements.
  return [...kept.slice(0, 5), ...complements, ...kept.slice(5)]
}

export function assessEvidence(query: string, results: WorkingResult[]) {
  const terms = evidenceTerms(query)
  const supported = new Set(results.slice(0, 5).flatMap((r) => evidenceTerms(`${r.file} ${r.metadata.symbolName ?? ""} ${r.content}`)))
  const matched = terms.filter((term) => supported.has(term))
  const portuguese = /[ãõçáéíóúâêô]/i.test(query) || (query.toLowerCase().match(/\b(onde|como|quando|nao|uma|para|por|com|que|dos|das|de|da|do|se|durante|depois|antes)\b/g)?.length ?? 0) >= 2
  const namedTerms = evidenceTerms((query.match(/\b(?:[A-Z]{2,}|[A-Z][a-zA-Z]{2,})\b/g) ?? []).join(" "))
  const crossLanguageUnsupported = !portuguese || namedTerms.filter((term) => !supported.has(term)).length >= 2
  // Conservative advisory only: several independent query terms must be missing.
  // Never discard semantic matches, including cross-language matches.
  const weak = results.length === 0 || (crossLanguageUnsupported && terms.length >= 4 && matched.length / terms.length < 0.25
    && !results.some((r) => r.semanticScore > 1))
  return {
    status: weak ? "weak-evidence" as const : "not-assessed" as const,
    method: "lexical-support-v1",
    matchedTerms: matched,
    missingTerms: terms.filter((term) => !supported.has(term)),
    scope: "returned-candidates",
    calibrated: false,
    crossLanguageLimited: portuguese,
  }
}
