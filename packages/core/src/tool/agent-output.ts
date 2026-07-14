import { createResultId } from "./result-id.js"

export type AgentDetail = "minimal" | "content" | "diagnostic" | "full"
export type GroupedAgentDetail = "summary" | "representatives" | "full"

export type AgentProjectionOptions = {
  detail?: AgentDetail | "compact"
  groupedDetail?: GroupedAgentDetail
  diagnostics?: boolean
  includeCode?: boolean
  includeFilterExplanations?: boolean
  includeRendered?: boolean
}

export type AgentBudgetOptions = {
  pretty?: boolean
  trailingNewline?: boolean
}

export const AGENT_SCHEMA_VERSION = 2

export const AgentOutputJsonSchema = {
  type: "object",
  required: ["schemaVersion", "command", "status"],
  properties: {
    schemaVersion: { type: "number" },
    command: { type: "string" },
    status: { type: "string" },
    warnings: { type: "array", items: { type: "object" } },
  },
  additionalProperties: true,
} as const

function defined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

export function resolveAgentDetail(value: unknown, diagnostic = false): AgentDetail {
  if (value === "full" || value === "content") return value
  if (value === "diagnostic" || diagnostic) return "diagnostic"
  return "minimal"
}

function warningCode(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes("stale")) return "INDEX_STALE"
  if (normalized.includes("embedding") || normalized.includes("lexical-fallback") || normalized.includes("provider")) return "EMBEDDING_FALLBACK"
  if (normalized.includes("schema") || normalized.includes("migration")) return "INDEX_INCOMPATIBLE"
  if (normalized.includes("file filter") || normalized.includes("no indexed files matched")) return "EMPTY_SCOPE"
  if (normalized.includes("truncat") || normalized.includes("budget")) return "OUTPUT_TRUNCATED"
  return "WARNING"
}

function projectWarnings(warnings: unknown): Array<{ code: string; message: string }> {
  if (!Array.isArray(warnings)) return []
  return warnings
    .filter((warning): warning is string => typeof warning === "string" && warning.length > 0)
    .map((message) => ({ code: warningCode(message), message }))
}

function projectIndex(index: any): Record<string, unknown> | undefined {
  if (!index) return undefined
  if (index.freshnessScope === "target-location" || index.scope === "target-location") {
    return { status: index.targetFresh === false ? "stale" : "fresh", scope: "target-location" }
  }
  const status = index.schemaCompatible === false
    ? "incompatible"
    : index.fresh === true
      ? "fresh"
      : index.fresh === false
        ? "stale"
        : "unknown"
  return { status }
}

function projectRetrieval(raw: any, status: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined
  return defined({
    mode: raw.actualMode ?? raw.mode ?? raw.requestedMode,
    exhaustive: raw.exhaustive === true,
    truncated: status === "incomplete" || raw.truncated === true,
    universe: raw.universe,
  })
}

function projectBudget(raw: any, status: unknown, diagnostics: boolean): Record<string, unknown> | undefined {
  if (!raw) return undefined
  const maxTokens = raw.maxTotalTokens ?? raw.tokensRequested
  const maxBytes = raw.maxOutputBytes ?? raw.maxBytes
  const usedTokens = raw.contextTokens ?? raw.tokensUsed
  if (!diagnostics && maxTokens === undefined && maxBytes === undefined && status !== "incomplete") return undefined
  return defined({
    maxTokens,
    maxBytes,
    usedTokens,
    ...(diagnostics ? {
      retrievalTokens: raw.retrievalTokens ?? raw.inputTokens,
      internalPayloadBytes: raw.attemptedOutputBytes ?? raw.outputBytes,
      internalPayloadTokens: raw.attemptedTokens,
      embeddingRequests: raw.embeddingRequests,
      embeddingTimeoutMs: raw.embeddingTimeoutMs,
      elapsedMs: raw.elapsedMs,
    } : {}),
  })
}

function resultLocation(entry: any): { file: string; startLine: number; endLine: number; symbol?: string } {
  return {
    file: String(entry.file ?? ""),
    startLine: Number(entry.startLine ?? entry.lines?.[0] ?? 0),
    endLine: Number(entry.endLine ?? entry.lines?.[1] ?? entry.startLine ?? 0),
    symbol: entry.symbolName ?? entry.symbol,
  }
}

export function projectAgentResult(entry: any, rank: number, options: AgentProjectionOptions = {}): Record<string, unknown> {
  const detail = options.detail === "compact" ? "minimal" : options.detail ?? "minimal"
  const diagnostics = options.diagnostics === true || detail === "diagnostic"
  const includeContent = detail === "content"
  const location = resultLocation(entry)
  const contentTruncated = entry.contentTruncated === true || entry.metadata?.contentTruncated === true
  const contentLineCount = typeof entry.content === "string" ? Math.max(1, entry.content.split("\n").length) : 0
  const card: Record<string, unknown> = defined({
    id: entry.resultId ?? entry.id ?? createResultId(location),
    file: location.file,
    lines: [location.startLine, location.endLine],
    symbol: location.symbol,
    kind: entry.semanticKind ?? entry.symbolType ?? entry.kind ?? entry.type,
    rank,
    relevance: entry.score ?? entry.relevance,
    ...(includeContent ? {
      content: entry.content,
      integrity: entry.snippetIntegrity,
      contentTruncated: contentTruncated || undefined,
      contentLines: contentTruncated && contentLineCount > 0
        ? [location.startLine, Math.min(location.endLine, location.startLine + contentLineCount - 1)]
        : undefined,
    } : {}),
    ...(options.includeFilterExplanations ? {
      why: entry.whyMatched,
      filterMatches: entry.filterMatches,
    } : {}),
  })
  if (diagnostics) {
    card.diagnostic = defined({
      rawDistance: entry.rawDistance,
      distanceMetric: entry.distanceMetric,
      language: entry.language,
      symbolType: entry.symbolType,
      semanticKind: entry.semanticKind,
      framework: entry.framework,
      fileRole: entry.fileRole ?? entry.metadata?.fileRole,
      confidence: entry.confidence,
      weakMatch: entry.isWeakMatch,
      why: entry.whyMatched,
      filterMatches: entry.filterMatches,
      estimatedTokens: entry.estimatedTokens,
      chunksMatched: entry.chunksMatched,
      integrity: entry.snippetIntegrity,
      internalRankScore: entry.rankScore,
    })
  }
  return card
}

function baseEnvelope(raw: any, options: AgentProjectionOptions): Record<string, unknown> {
  const diagnostics = options.diagnostics === true || options.detail === "diagnostic"
  const warnings = projectWarnings(raw.warnings)
  return defined({
    schemaVersion: AGENT_SCHEMA_VERSION,
    command: raw.command,
    status: raw.status ?? "complete",
    warnings,
    retrieval: projectRetrieval(raw.retrieval, raw.status),
    index: projectIndex(raw.index),
    budget: projectBudget(raw.budget, raw.status, diagnostics),
  })
}

export function projectSearchAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  if (options.detail === "full") return raw
  const diagnostics = options.diagnostics === true || options.detail === "diagnostic"
  const results = Array.isArray(raw.results)
    ? raw.results.map((entry: any, index: number) => projectAgentResult(entry, index + 1, options))
    : []
  const response: Record<string, unknown> = {
    ...baseEnvelope(raw, options),
    ...(raw.coverage ? {
      coverage: defined({
        changedFiles: raw.coverage.changedFiles,
        semanticFiles: raw.coverage.semantic?.representedFiles ?? raw.coverage.semanticRepresentedFiles ?? raw.coverage.representedFiles,
        textualFiles: raw.coverage.textual?.representedFiles,
        exhaustive: raw.coverage.exhaustive,
        truncated: raw.coverage.truncated,
        reasons: raw.coverage.truncationReasons,
      }),
      coverageSatisfied: raw.coverageSatisfied,
    } : {}),
    ...(raw.batches ? { batches: raw.batches } : {}),
    results,
    ...(raw.truncated === true ? { truncated: true } : {}),
    ...(options.includeRendered ? { rendered: raw.output } : {}),
  }
  if (diagnostics) {
    response.diagnostic = defined({
      metrics: raw.metrics,
      freshness: raw.freshness,
      distanceMetric: raw.results?.find((entry: any) => entry.distanceMetric)?.distanceMetric,
      retrieval: raw.retrieval,
      index: raw.index,
      budget: raw.budget,
    })
  }
  return response
}

export function projectLiteralAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  if (options.detail === "full") return raw
  const diagnostics = options.diagnostics === true || options.detail === "diagnostic"
  const matches = (raw.matches ?? []).map((match: any) => defined({
    id: match.resultId ?? (match.chunkStartLine ? createResultId({
      file: match.file,
      startLine: match.chunkStartLine,
      endLine: match.chunkEndLine ?? match.chunkStartLine,
      symbol: match.symbolName,
    }) : Number.isInteger(match.line) && match.line > 0 ? createResultId({
      file: match.file,
      startLine: match.line,
      endLine: match.line,
      symbol: match.symbolName,
    }) : undefined),
    file: match.file,
    line: match.line,
    text: match.text,
    symbol: match.symbolName,
    kind: match.semanticKind ?? match.symbolType,
  }))
  return {
    ...baseEnvelope({ ...raw, command: raw.command ?? "literal" }, options),
    summary: {
      total: raw.metadata?.totalMatches ?? matches.length,
      returned: raw.metadata?.returnedMatches ?? matches.length,
      truncated: raw.metadata?.truncated ?? false,
      exhaustive: raw.retrieval?.exhaustive ?? raw.metadata?.exhaustive ?? false,
    },
    matches,
    ...(diagnostics ? { diagnostic: { metadata: raw.metadata, retrieval: raw.retrieval, index: raw.index, budget: raw.budget } } : {}),
  }
}

function projectGroupedItem(group: any, index: number, detail: GroupedAgentDetail): Record<string, unknown> {
  const representativeResults = Array.isArray(group.results) ? group.results : []
  const representativeIds = group.representativeIds ?? representativeResults.map((entry: any) => entry.resultId).filter(Boolean)
  return defined({
    label: group.title ?? group.label,
    rank: index + 1,
    matches: group.matches,
    files: group.files,
    terms: group.representativeTerms ?? group.terms,
    representativeIds,
    ...(detail === "representatives" ? {
      representatives: representativeResults.map((entry: any, resultIndex: number) => projectAgentResult(entry, resultIndex + 1, { detail: "content" })),
    } : {}),
  })
}

export function projectGroupedAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  const detail = options.groupedDetail ?? "summary"
  if (detail === "full") return raw
  const key = raw.command === "cluster" ? "clusters" : "groups"
  return {
    ...baseEnvelope(raw, options),
    [key]: (raw[key] ?? []).map((group: any, index: number) => projectGroupedItem(group, index, detail)),
    ...(options.diagnostics ? { diagnostic: { metadata: raw.metadata, freshness: raw.freshness, retrieval: raw.retrieval, budget: raw.budget } } : {}),
  }
}

export function projectShowAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  if (options.detail === "full") return raw
  const location = raw.result ? resultLocation(raw.result) : undefined
  const graphDetail = options.diagnostics || options.detail === "diagnostic" ? "diagnostic" : "minimal"
  const graph = raw.graph ? {
    ...(raw.graph.references ? {
      references: projectGraphAgentResponse({ ...raw.graph.references, command: "references" }, { detail: graphDetail }),
    } : {}),
    ...(raw.graph.impact ? {
      impact: projectGraphAgentResponse({ ...raw.graph.impact, command: "impact" }, { detail: graphDetail }),
    } : {}),
  } : undefined
  return {
    ...baseEnvelope(raw, options),
    ...(raw.result && location ? {
      result: defined({
        id: raw.result.resultId,
        file: location.file,
        lines: [location.startLine, location.endLine],
        symbol: location.symbol,
        content: raw.result.content,
        integrity: raw.result.snippetIntegrity,
      }),
    } : {}),
    ...(graph ? { graph } : {}),
    ...(options.diagnostics || options.detail === "diagnostic" ? {
      diagnostic: defined({ freshness: raw.freshness, index: raw.index, metadata: raw.metadata }),
    } : {}),
    ...(options.includeRendered ? { rendered: raw.output } : {}),
  }
}

function projectDuplicateInstance(instance: any, includeCode: boolean): Record<string, unknown> {
  const location = resultLocation(instance)
  return defined({
    id: instance.resultId ?? createResultId(location),
    file: location.file,
    lines: [location.startLine, location.endLine],
    symbol: location.symbol,
    complexity: instance.complexity,
    ...(includeCode ? { content: instance.content } : {}),
  })
}

export function projectDuplicateAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  if (options.detail === "full") return raw
  const diagnostics = options.diagnostics === true || options.detail === "diagnostic"
  const summary = defined({
    total: raw.summary?.totalDuplicates,
    returned: raw.summary?.returnedDuplicates,
    candidates: raw.summary?.candidates,
    processed: raw.summary?.processedCandidates ?? raw.summary?.analyzedCandidates,
    truncated: raw.summary?.truncated,
    timedOut: raw.summary?.timedOut,
  })
  return {
    schemaVersion: AGENT_SCHEMA_VERSION,
    command: raw.command ?? "detect-duplicates",
    status: raw.status ?? "complete",
    warnings: projectWarnings(raw.warnings),
    summary,
    duplicates: (raw.duplicates ?? []).map((group: any) => defined({
      level: group.level,
      similarity: group.similarity,
      type: group.duplicateType,
      savings: group.impact?.estimatedSavings,
      instances: (group.instances ?? []).map((instance: any) => projectDuplicateInstance(instance, options.includeCode === true)),
      ...(diagnostics ? { diagnostic: { impact: group.impact, structuralSummary: group.structuralSummary, refactorHint: group.refactorHint, likelyAcceptable: group.isLikelyOk } } : {}),
    })),
    ...(raw.summary?.resumeCursor !== undefined ? {
      continuation: { cursor: raw.summary.resumeCursor, command: "detect-duplicates" },
    } : {}),
  }
}

function projectGraphLocation(location: any): Record<string, unknown> {
  const value = location.location ?? location
  const normalized = resultLocation(value)
  return defined({
    id: createResultId(normalized),
    file: normalized.file,
    lines: [normalized.startLine, normalized.endLine],
    symbol: normalized.symbol ?? location.symbol ?? location.name,
  })
}

export function projectGraphAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  if (options.detail === "full") return raw
  const diagnostics = options.diagnostics === true || options.detail === "diagnostic"
  const base = { schemaVersion: AGENT_SCHEMA_VERSION, command: raw.command, status: raw.status ?? "complete" }
  let response: Record<string, unknown>
  if (raw.command === "references") {
    response = {
      ...base,
      symbol: raw.symbol,
      definitions: (raw.definitions ?? []).map(projectGraphLocation),
      references: (raw.references ?? []).map((reference: any) => defined({
        fromId: reference.fromId,
        kind: reference.kind,
        confidence: reference.confidence,
      })),
      truncated: raw.truncated ?? false,
      graphCoverage: raw.metrics?.graphCoverage,
    }
  } else if (raw.command === "impact") {
    response = {
      ...base,
      symbol: raw.symbol,
      definitions: (raw.definitions ?? []).map(projectGraphLocation),
      impacted: (raw.impacted ?? []).map((entry: any) => ({ ...projectGraphLocation(entry), depth: entry.depth })),
      truncated: raw.truncated ?? false,
      graphCoverage: raw.metrics?.graphCoverage,
    }
  } else {
    response = {
      ...base,
      from: raw.from,
      to: raw.to,
      found: raw.found,
      path: raw.path,
      truncated: raw.truncated ?? false,
      graphCoverage: raw.metrics?.graphCoverage,
    }
  }
  if (diagnostics) {
    response.diagnostic = defined({
      metrics: raw.metrics,
      path: Array.isArray(raw.pathNodes) ? raw.pathNodes.map(projectGraphLocation) : undefined,
    })
  }
  return response
}

export function projectAgentResponse(raw: any, options: AgentProjectionOptions = {}): any {
  const command = String(raw?.command ?? "")
  if (command === "literal") return projectLiteralAgentResponse(raw, options)
  if (command === "show" || command === "expand") return projectShowAgentResponse(raw, options)
  if (command === "survey" || command === "cluster") return projectGroupedAgentResponse(raw, options)
  if (command === "detect-duplicates") return projectDuplicateAgentResponse(raw, options)
  if (command === "references" || command === "impact" || command === "trace") return projectGraphAgentResponse(raw, options)
  return projectSearchAgentResponse(raw, options)
}

function serialize(payload: unknown, options: AgentBudgetOptions): string {
  const json = JSON.stringify(payload, null, options.pretty ? 2 : undefined)
  return options.trailingNewline === false ? json : `${json}\n`
}

export function withAgentOutputMetrics(payload: any, options: AgentBudgetOptions = {}): any {
  if (!payload?.budget || typeof payload.budget !== "object") return payload
  let usedBytes = 0
  let measured = payload
  for (let iteration = 0; iteration < 10; iteration++) {
    measured = {
      ...payload,
      budget: { ...payload.budget, usedBytes, usedTokens: Math.ceil(usedBytes / 4) },
    }
    const nextBytes = Buffer.byteLength(serialize(measured, options))
    if (nextBytes === usedBytes) return measured
    usedBytes = nextBytes
  }
  return measured
}

function markTruncated(payload: any): any {
  return {
    ...payload,
    status: "incomplete",
    truncated: true,
    retrieval: payload.retrieval ? { ...payload.retrieval, exhaustive: false, truncated: true } : payload.retrieval,
    coverage: payload.coverage ? { ...payload.coverage, exhaustive: false, truncated: true } : payload.coverage,
    coverageSatisfied: payload.coverage ? false : payload.coverageSatisfied,
  }
}

function replaceCollection(payload: any, key: string, values: any[]): any {
  const next = { ...payload, [key]: values }
  if (key === "matches" && next.summary) next.summary = { ...next.summary, returned: values.length, truncated: true, exhaustive: false }
  if (key === "results" && Array.isArray(next.batches)) {
    const retained = new Set(values.map((entry) => entry.id).filter(Boolean))
    next.batches = next.batches
      .map((batch: any) => ({
        ...batch,
        resultIds: batch.resultIds?.filter((id: string) => retained.has(id)),
        ranges: batch.ranges?.filter((range: any) => retained.has(range.resultId ?? range.id)),
      }))
      .filter((batch: any) => !Array.isArray(batch.resultIds) || batch.resultIds.length > 0)
  }
  return next
}

function truncateContent(entry: any, maxCharacters: number): any {
  const original = String(entry.content ?? "")
  let content = original.slice(0, maxCharacters)
  const newline = content.lastIndexOf("\n")
  if (newline >= Math.floor(maxCharacters / 2)) content = content.slice(0, newline)
  const lines = Array.isArray(entry.lines) ? entry.lines : undefined
  const emittedLines = Math.max(1, content.split("\n").length)
  return {
    ...entry,
    ...(lines ? { contentLines: [lines[0], Math.min(lines[1], lines[0] + emittedLines - 1)] } : {}),
    content,
    contentTruncated: content.length < original.length,
    integrity: content.length < original.length ? "partial" : entry.integrity,
  }
}

function fitPartialContent(payload: any, key: string, retained: any[], nextEntry: any, maxBytes: number, options: AgentBudgetOptions): any | undefined {
  if (typeof nextEntry?.content !== "string" || nextEntry.content.length === 0) return undefined
  let low = 1
  let high = nextEntry.content.length
  let best: any
  while (low <= high) {
    const length = Math.floor((low + high) / 2)
    const candidate = withAgentOutputMetrics(replaceCollection(payload, key, [...retained, truncateContent(nextEntry, length)]), options)
    if (candidate.budget.usedBytes <= maxBytes) {
      best = candidate
      low = length + 1
    } else {
      high = length - 1
    }
  }
  return best
}

export function enforceAgentOutputBudget(payload: any, options: AgentBudgetOptions = {}): any {
  let projected = withAgentOutputMetrics(payload, options)
  const maxBytes = Number(projected?.budget?.maxBytes ?? 0)
  if (!maxBytes || projected.budget.usedBytes <= maxBytes) return projected
  projected = withAgentOutputMetrics(markTruncated(projected), options)
  const collectionKeys = ["results", "matches", "groups", "clusters", "references", "impacted", "duplicates", "batches"]
  for (const key of collectionKeys) {
    if (!Array.isArray(projected[key]) || projected[key].length === 0) continue
    const original = [...projected[key]]
    let low = 0
    let high = original.length
    let best: any
    let bestCount = 0
    while (low <= high) {
      const count = Math.floor((low + high) / 2)
      const candidate = withAgentOutputMetrics(replaceCollection(projected, key, original.slice(0, count)), options)
      if (candidate.budget.usedBytes <= maxBytes) {
        best = candidate
        bestCount = count
        low = count + 1
      } else {
        high = count - 1
      }
    }
    const partial = bestCount < original.length
      ? fitPartialContent(projected, key, original.slice(0, bestCount), original[bestCount], maxBytes, options)
      : undefined
    if (partial) return partial
    if (best) return best
    projected = withAgentOutputMetrics(replaceCollection(projected, key, []), options)
  }
  const compact = withAgentOutputMetrics({
    schemaVersion: AGENT_SCHEMA_VERSION,
    command: projected.command,
    status: "incomplete",
    truncated: true,
    budget: { maxBytes },
  }, options)
  if (Buffer.byteLength(serialize(compact, options)) <= maxBytes) return compact
  const emergency = { schemaVersion: AGENT_SCHEMA_VERSION, command: projected.command, status: "incomplete", truncated: true }
  return Buffer.byteLength(serialize(emergency, options)) <= maxBytes ? emergency : {}
}
