import { isPrettyJson, serializeJson, writeJson, writeStdoutLine } from "./output.js"

export type Flags = Record<string, string | boolean>
type CoreModule = typeof import("@sensegrep/core")

export type SearchLikeParams = Record<string, unknown> & {
  query: string
  shake?: boolean
}

export type JsonProjection = "minimal" | "content" | "diagnostic" | "full"

export function resolveJsonProjection(value: unknown, diagnostic = false): JsonProjection {
  if (diagnostic) return "diagnostic"
  if (value === "full" || value === "content" || value === "diagnostic") return value
  return "minimal"
}

export function compactSearchResult(entry: any, includeFilterExplanations = false) {
  return {
    resultId: entry.resultId,
    file: entry.file,
    startLine: entry.startLine,
    endLine: entry.endLine,
    symbolName: entry.symbolName,
    symbolType: entry.symbolType,
    score: entry.score,
    rankScore: entry.rankScore,
    ...(includeFilterExplanations ? {
      ...(entry.whyMatched ? { whyMatched: entry.whyMatched } : {}),
      ...(entry.filterMatches ? { filterMatches: entry.filterMatches } : {}),
    } : {}),
  }
}

function diagnosticSearchResult(entry: any) {
  const { metadata: _metadata, ...result } = entry
  return { ...result, fileRole: entry.fileRole ?? entry.metadata?.fileRole }
}

function minimalCoverage(coverage: any) {
  if (!coverage) return undefined
  return {
    changedFiles: coverage.changedFiles,
    semanticRepresentedFiles: coverage.semantic?.representedFiles ?? coverage.semanticRepresentedFiles ?? coverage.representedFiles,
    textualRepresentedFiles: coverage.textual?.representedFiles,
    exhaustive: coverage.exhaustive,
    truncated: coverage.truncated,
    truncationReasons: coverage.truncationReasons,
  }
}

function minimalBudget(budget: any) {
  if (!budget) return undefined
  return {
    contextTokens: budget.contextTokens ?? budget.tokensUsed,
    maxTotalTokens: budget.maxTotalTokens ?? budget.tokensRequested,
    maxOutputBytes: budget.maxOutputBytes,
    attemptedOutputBytes: budget.attemptedOutputBytes,
    attemptedTokens: budget.attemptedTokens,
  }
}

export function projectSearchResponse(
  res: any,
  detail: JsonProjection,
  includeRendered = false,
  includeFilterExplanations = false,
): any {
  if (detail === "full") return res
  if (detail === "diagnostic") {
    const { output: _output, metadata: _metadata, title: _title, ...diagnostic } = res
    const diagnosticResults = Array.isArray(res.results) ? res.results.map((entry: any) => {
      const { distanceMetric: _distanceMetric, ...projected } = diagnosticSearchResult(entry)
      return projected
    }) : res.results
    return {
      ...diagnostic,
      distanceMetric: res.results?.find((entry: any) => entry.distanceMetric)?.distanceMetric,
      results: diagnosticResults,
      ...(includeRendered ? { output: res.output } : {}),
    }
  }

  const cards = Array.isArray(res.results)
    ? res.results.map((entry: any) => detail === "content"
      ? { ...compactSearchResult(entry, includeFilterExplanations), content: entry.content }
      : compactSearchResult(entry, includeFilterExplanations))
    : res.results
  const retrieval = res.retrieval ? {
    actualMode: res.retrieval.actualMode ?? res.retrieval.requestedMode,
    exhaustive: res.retrieval.exhaustive === true,
    truncated: res.status === "incomplete" || res.coverage?.truncated === true,
    universe: res.retrieval.universe,
  } : undefined
  return {
    schemaVersion: res.schemaVersion ?? 1,
    command: res.command,
    status: res.status,
    ...(Array.isArray(res.warnings) && res.warnings.length > 0 ? { warnings: res.warnings } : {}),
    ...(retrieval ? { retrieval } : {}),
    ...(res.index ? { index: res.index } : {}),
    ...(res.coverage ? { coverage: minimalCoverage(res.coverage), coverageSatisfied: res.coverageSatisfied } : {}),
    ...(res.batches ? { batches: res.batches } : {}),
    ...(res.budget ? { budget: minimalBudget(res.budget) } : {}),
    results: cards,
    ...(includeRendered ? { output: res.output } : {}),
  }
}

function locationResultId(instance: any): string {
  return `symbol:${Buffer.from(JSON.stringify({
    file: instance.file,
    startLine: instance.startLine,
    endLine: instance.endLine,
    symbol: instance.symbol ?? instance.symbolName,
  })).toString("base64url")}`
}

function projectDuplicateGroup(group: any, includeCode: boolean, diagnostic: boolean) {
  return {
    level: group.level,
    similarity: group.similarity,
    ...(group.duplicateType ? { duplicateType: group.duplicateType } : {}),
    impact: diagnostic ? group.impact : {
      estimatedSavings: group.impact?.estimatedSavings,
      score: group.impact?.score,
    },
    instances: (group.instances ?? []).map((instance: any) => ({
      resultId: locationResultId(instance),
      file: instance.file,
      startLine: instance.startLine,
      endLine: instance.endLine,
      symbolName: instance.symbol,
      complexity: instance.complexity,
      ...(includeCode ? { content: instance.content } : {}),
      ...(diagnostic ? { symbolType: instance.symbolType, language: instance.language } : {}),
    })),
    ...(diagnostic ? {
      structuralSummary: group.structuralSummary,
      refactorHint: group.refactorHint,
      isLikelyOk: group.isLikelyOk,
    } : {}),
  }
}

export function projectDuplicateResponse(res: any, detail: JsonProjection, includeCode: boolean): any {
  const diagnostic = detail === "diagnostic" || detail === "full"
  return {
    schemaVersion: res.schemaVersion ?? 1,
    command: res.command ?? "detect-duplicates",
    status: res.status,
    summary: diagnostic ? res.summary : {
      totalDuplicates: res.summary?.totalDuplicates,
      returnedDuplicates: res.summary?.returnedDuplicates,
      candidates: res.summary?.candidates,
      processedCandidates: res.summary?.processedCandidates,
      truncated: res.summary?.truncated,
      timedOut: res.summary?.timedOut,
      resumeCursor: res.summary?.resumeCursor,
      elapsedMs: res.summary?.elapsedMs,
    },
    duplicates: (res.duplicates ?? []).map((group: any) => projectDuplicateGroup(group, includeCode, diagnostic)),
    ...(diagnostic && Array.isArray(res.acceptableDuplicates) ? {
      acceptableDuplicates: res.acceptableDuplicates.map((group: any) => projectDuplicateGroup(group, includeCode, true)),
    } : {}),
  }
}

export function projectLiteralResponse(res: any, detail: JsonProjection): any {
  if (detail === "full") return res
  if (detail === "diagnostic") {
    const { output: _output, title: _title, metadata: _metadata, ...diagnostic } = res
    return diagnostic
  }
  return {
    schemaVersion: res.schemaVersion ?? 1,
    command: "literal",
    status: res.status,
    totalMatches: res.metadata?.totalMatches ?? res.matches?.length ?? 0,
    returnedMatches: res.metadata?.returnedMatches ?? res.matches?.length ?? 0,
    truncated: res.metadata?.truncated ?? false,
    exhaustive: res.retrieval?.exhaustive ?? res.metadata?.exhaustive ?? false,
    retrieval: res.retrieval ? {
      actualMode: res.retrieval.actualMode,
      exhaustive: res.retrieval.exhaustive,
      exhaustiveWithin: res.retrieval.exhaustiveWithin,
      universe: res.retrieval.universe,
    } : undefined,
    index: res.index,
    budget: res.budget,
    ...(Array.isArray(res.warnings) && res.warnings.length > 0 ? { warnings: res.warnings } : {}),
    matches: (res.matches ?? []).map((match: any) => ({
      file: match.file,
      line: match.line,
      text: match.text,
      ...(match.symbolName ? { symbolName: match.symbolName } : {}),
    })),
  }
}

export function projectShowResponse(res: any, detail: JsonProjection, includeRendered = false): any {
  if (detail === "full") return res
  const result = res.result ? { ...res.result } : undefined
  return {
    schemaVersion: res.schemaVersion ?? 1,
    command: res.command,
    status: res.status,
    ...(Array.isArray(res.warnings) && res.warnings.length > 0 ? { warnings: res.warnings } : {}),
    index: res.index,
    result,
    ...(res.graph ? { graph: res.graph } : {}),
    ...(includeRendered ? { output: res.output } : {}),
  }
}

export function projectGraphResponse(res: any, detail: JsonProjection): any {
  if (detail === "full" || detail === "diagnostic") return res
  if (res.command === "references") {
    return {
      schemaVersion: res.schemaVersion ?? 1,
      command: "references",
      status: res.status,
      symbol: res.symbol,
      definitions: res.definitions,
      references: (res.references ?? []).map((reference: any) => ({
        fromId: reference.fromId,
        kind: reference.kind,
        confidence: reference.confidence,
      })),
      truncated: res.truncated,
      graphCoverage: res.metrics?.graphCoverage,
    }
  }
  if (res.command === "impact") {
    return {
      schemaVersion: res.schemaVersion ?? 1,
      command: "impact",
      status: res.status,
      symbol: res.symbol,
      definitions: res.definitions,
      impacted: res.impacted,
      truncated: res.truncated,
      graphCoverage: res.metrics?.graphCoverage,
    }
  }
  return {
    schemaVersion: res.schemaVersion ?? 1,
    command: "trace",
    status: res.status,
    from: res.from,
    to: res.to,
    found: res.found,
    path: res.path,
    truncated: res.truncated,
    graphCoverage: res.metrics?.graphCoverage,
  }
}

export function withActualOutputMetrics(payload: any, pretty = isPrettyJson()): any {
  if (!payload?.budget || typeof payload.budget !== "object") return payload
  const projectedBytes = Buffer.byteLength(serializeJson(payload, pretty))
  const baseAttemptedOutputBytes = Math.max(
    projectedBytes,
    Number(payload.budget.attemptedOutputBytes || payload.budget.outputBytes || 0),
  )
  const baseAttemptedTokens = Number(payload.budget.attemptedTokens || payload.budget.emittedTokens || 0)
  let actualOutputBytes = 0
  let actualEmittedTokens = 0
  let measured = payload
  for (let iteration = 0; iteration < 10; iteration++) {
    const attemptedOutputBytes = Math.max(baseAttemptedOutputBytes, actualOutputBytes)
    const attemptedTokens = Math.max(Math.ceil(attemptedOutputBytes / 4), baseAttemptedTokens)
    measured = {
      ...payload,
      budget: {
        ...payload.budget,
        attemptedOutputBytes,
        attemptedTokens,
        actualOutputBytes,
        actualEmittedTokens,
        outputBytes: actualOutputBytes,
        emittedTokens: actualEmittedTokens,
      },
    }
    const nextBytes = Buffer.byteLength(serializeJson(measured, pretty))
    const nextTokens = Math.ceil(nextBytes / 4)
    if (nextBytes === actualOutputBytes && nextTokens === actualEmittedTokens) return measured
    actualOutputBytes = nextBytes
    actualEmittedTokens = nextTokens
  }
  return {
    ...measured,
    budget: {
      ...measured.budget,
      attemptedOutputBytes: Math.max(baseAttemptedOutputBytes, actualOutputBytes),
      attemptedTokens: Math.max(Math.ceil(Math.max(baseAttemptedOutputBytes, actualOutputBytes) / 4), baseAttemptedTokens),
      actualOutputBytes,
      actualEmittedTokens,
      outputBytes: actualOutputBytes,
      emittedTokens: actualEmittedTokens,
    },
  }
}

function markOutputTruncated(payload: any) {
  const reasons = new Set([...(payload.coverage?.truncationReasons ?? []), "actual-output-budget"])
  return {
    ...payload,
    status: "incomplete",
    truncated: true,
    ...(typeof payload.exhaustive === "boolean" ? { exhaustive: false } : {}),
    retrieval: payload.retrieval ? { ...payload.retrieval, exhaustive: false, truncated: true } : payload.retrieval,
    metadata: payload.metadata ? { ...payload.metadata, truncated: true, exhaustive: false } : payload.metadata,
    coverage: payload.coverage ? { ...payload.coverage, exhaustive: false, truncated: true, truncationReasons: [...reasons] } : payload.coverage,
    coverageSatisfied: payload.coverage ? false : payload.coverageSatisfied,
  }
}

export function enforceActualOutputBudget(payload: any, pretty = isPrettyJson()): any {
  const maxOutputBytes = Number(payload?.budget?.maxOutputBytes ?? 0)
  let projected = withActualOutputMetrics(payload, pretty)
  if (!maxOutputBytes || projected.budget.actualOutputBytes <= maxOutputBytes) return projected
  projected = markOutputTruncated(projected)
  const collectionKeys = ["results", "matches", "groups", "clusters", "references", "impacted", "duplicates", "batches"]
  const replaceCollection = (source: any, key: string, values: any[]) => {
    const next = { ...source, [key]: values }
    if (key === "results") {
      const retainedIds = new Set(values.map((entry: any) => entry.resultId).filter(Boolean))
      if (Array.isArray(source.batches)) {
        next.batches = source.batches
          .map((batch: any) => ({
            ...batch,
            resultIds: Array.isArray(batch.resultIds) ? batch.resultIds.filter((id: string) => retainedIds.has(id)) : batch.resultIds,
            ranges: Array.isArray(batch.ranges) ? batch.ranges.filter((range: any) => retainedIds.has(range.resultId)) : batch.ranges,
          }))
          .filter((batch: any) => !Array.isArray(batch.resultIds) || batch.resultIds.length > 0)
      }
    }
    if (key === "matches") {
      next.returnedMatches = values.length
      if (next.metadata) next.metadata = { ...next.metadata, returnedMatches: values.length, truncated: true, exhaustive: false }
    }
    return next
  }

  for (const key of collectionKeys) {
    if (!Array.isArray(projected[key]) || projected[key].length === 0) continue
    const original = [...projected[key]]
    let low = 0
    let high = original.length
    let best: any | undefined
    while (low <= high) {
      const count = Math.floor((low + high) / 2)
      const candidate = withActualOutputMetrics(replaceCollection(projected, key, original.slice(0, count)), pretty)
      if (candidate.budget.actualOutputBytes <= maxOutputBytes) {
        best = candidate
        low = count + 1
      } else {
        high = count - 1
      }
    }
    if (best) return best
    projected = withActualOutputMetrics(replaceCollection(projected, key, []), pretty)
  }

  const compact = withActualOutputMetrics({
    schemaVersion: projected.schemaVersion ?? 1,
    command: projected.command,
    status: "incomplete",
    truncated: true,
    ...(projected.retrieval?.actualMode || projected.retrieval?.mode ? {
      retrieval: { actualMode: projected.retrieval.actualMode ?? projected.retrieval.mode },
    } : {}),
    budget: { maxOutputBytes, attemptedOutputBytes: projected.budget.attemptedOutputBytes },
  }, pretty)
  if (Buffer.byteLength(serializeJson(compact, pretty)) <= maxOutputBytes) return compact

  const emergency = { command: projected.command, status: "incomplete", truncated: true }
  if (Buffer.byteLength(serializeJson(emergency, pretty)) <= maxOutputBytes) return emergency
  const smallest = { status: "incomplete" }
  return Buffer.byteLength(serializeJson(smallest, pretty)) <= maxOutputBytes ? smallest : {}
}

export type SearchLikeToolFactory = {
  init(): Promise<{
    execute(
      params: Record<string, unknown>,
      context: {
        sessionID: string
        messageID: string
        agent: string
        abort: AbortSignal
        metadata(input: { title?: string; metadata?: unknown }): void
      },
    ): Promise<{ output: string; [key: string]: unknown }>
  }>
}

export function toBool(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value
  if (!value) return undefined
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase())
}

export function getSearchQuery(flags: Flags, positional: string[]): string | undefined {
  return (flags.query as string | undefined) || positional.join(" ")
}

function firstDefinedFlag(flags: Flags, names: string[]): string | boolean | undefined {
  for (const name of names) {
    if (flags[name] !== undefined) return flags[name]
  }
  return undefined
}

function assignStringParam(params: SearchLikeParams, flags: Flags, key: string, names: string[]) {
  const value = firstDefinedFlag(flags, names)
  if (value !== undefined) params[key] = String(value)
}

export function assignNumberParam(params: SearchLikeParams, flags: Flags, key: string, names: string[]) {
  const value = firstDefinedFlag(flags, names)
  if (value !== undefined) params[key] = Number(value)
}

function assignBooleanParam(params: SearchLikeParams, flags: Flags, key: string, names: string[]) {
  const value = firstDefinedFlag(flags, names)
  if (value !== undefined) {
    const parsed = toBool(value)
    if (parsed !== undefined) params[key] = parsed
  }
}

export function buildCommonSearchParams(query: string, flags: Flags, defaults: Omit<SearchLikeParams, "query"> = {}): SearchLikeParams {
  const params: SearchLikeParams = { query, ...defaults }

  assignStringParam(params, flags, "pattern", ["pattern"])
  assignNumberParam(params, flags, "limit", ["limit"])
  assignStringParam(params, flags, "include", ["include"])
  assignStringParam(params, flags, "exclude", ["exclude"])
  assignStringParam(params, flags, "symbolType", ["type", "symbolType"])
  assignStringParam(params, flags, "variant", ["variant"])
  assignStringParam(params, flags, "decorator", ["decorator"])
  if (flags.async !== undefined) params.isAsync = true
  if (flags.static !== undefined) params.isStatic = true
  if (flags.abstract !== undefined) params.isAbstract = true
  assignBooleanParam(params, flags, "isExported", ["exported"])
  assignNumberParam(params, flags, "minComplexity", ["min-complexity", "minComplexity"])
  assignNumberParam(params, flags, "maxComplexity", ["max-complexity", "maxComplexity"])
  assignBooleanParam(params, flags, "hasDocumentation", ["has-docs", "hasDocs"])
  assignStringParam(params, flags, "language", ["language"])
  assignStringParam(params, flags, "parentScope", ["parent", "parentScope"])
  assignStringParam(params, flags, "imports", ["imports"])
  assignStringParam(params, flags, "semanticKind", ["semantic-kind", "semanticKind"])
  if (flags["explain-filters"] !== undefined || flags.explainFilters !== undefined) params.explainFilters = true
  if (flags["strict-parent"] !== undefined || flags.strictParent !== undefined) params.strictParent = true
  if (flags["strict-imports"] !== undefined || flags.strictImports !== undefined) params.strictImports = true
  assignStringParam(params, flags, "symbol", ["symbol", "name"])
  if (flags["no-shake"] !== undefined) params.shake = false
  assignNumberParam(params, flags, "minScore", ["min-score", "minScore"])
  assignNumberParam(params, flags, "maxTokens", ["max-tokens", "maxTokens"])
  if (flags.hybrid !== undefined) params.hybrid = toBool(flags.hybrid) ?? true
  if (flags["no-hybrid"] !== undefined) params.hybrid = false
  assignStringParam(params, flags, "hybridMode", ["hybrid-mode", "hybridMode"])
  if (flags.changed !== undefined) params.gitChanged = true
  assignStringParam(params, flags, "gitBase", ["base"])
  assignNumberParam(params, flags, "embeddingTimeoutMs", ["embedding-timeout", "embeddingTimeout"])
  if (params.embeddingTimeoutMs === undefined) {
    assignNumberParam(params, flags, "embeddingTimeoutMs", ["latency-budget", "latencyBudget"])
  }
  assignStringParam(params, flags, "purpose", ["purpose"])
  assignStringParam(params, flags, "preferRole", ["prefer-role", "preferRole"])
  assignStringParam(params, flags, "includeRole", ["include-role", "includeRole"])
  assignStringParam(params, flags, "excludeRole", ["exclude-role", "excludeRole"])

  return params
}

export async function executeSearchLikeTool(input: {
  flags: Flags
  rootDir: string
  Instance: CoreModule["Instance"]
  toolFactory: SearchLikeToolFactory
  params: SearchLikeParams
}) {
  const tool = await input.toolFactory.init()
  const res = await input.Instance.provide({
    directory: input.rootDir,
    fn: () =>
      tool.execute(input.params, {
        sessionID: "cli",
        messageID: "cli",
        agent: "sensegrep-cli",
        abort: new AbortController().signal,
        metadata(_input: { title?: string; metadata?: unknown }) {},
      }),
  })
  if (input.params.requireCoverage === true && res.coverageSatisfied === false) process.exitCode = 2

  if (input.flags.json) {
    const rawResult = res as any
    const jsonDetail = input.params.jsonDetail
    const includeRendered = input.flags["include-rendered-output"] === true || input.flags.includeRenderedOutput === true
    let payload: any
    const attemptedOutputBytes = Buffer.byteLength(JSON.stringify(rawResult))
    const measuredResult = {
      ...rawResult,
      ...(rawResult.budget ? {
        budget: {
          ...rawResult.budget,
          attemptedOutputBytes: rawResult.budget.attemptedOutputBytes || attemptedOutputBytes,
          attemptedTokens: rawResult.budget.attemptedTokens || Math.ceil(attemptedOutputBytes / 4),
        },
      } : {}),
    }
    if (rawResult.command === "literal") {
      payload = projectLiteralResponse(measuredResult, resolveJsonProjection(jsonDetail, input.flags.diagnostic === true))
    } else if (rawResult.command === "show" || rawResult.command === "expand") {
      payload = projectShowResponse(rawResult, resolveJsonProjection(jsonDetail, input.flags.diagnostic === true), includeRendered)
    } else if (jsonDetail === "summary" || jsonDetail === "representatives") {
      const { output: _output, ...compact } = res
      payload = includeRendered ? { ...compact, output: res.output } : compact
    } else if (["search", "context", "audit"].includes(String(rawResult.command ?? ""))) {
      const detail = resolveJsonProjection(jsonDetail, input.flags.diagnostic === true)
      payload = projectSearchResponse(measuredResult, detail, includeRendered, input.params.explainFilters === true)
    } else if (includeRendered || jsonDetail === "full") {
      payload = rawResult
    } else {
      const { output: _output, ...withoutRendered } = rawResult
      payload = withoutRendered
    }
    const finalPayload = enforceActualOutputBudget(payload)
    if (input.params.requireCoverage === true && finalPayload.coverageSatisfied === false) process.exitCode = 2
    writeJson(finalPayload)
    return
  }
  writeStdoutLine(res.output)
}
