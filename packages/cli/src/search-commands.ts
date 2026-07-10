import { writeJson, writeStdoutLine } from "./output.js"

export type Flags = Record<string, string | boolean>
type CoreModule = typeof import("@sensegrep/core")

export type SearchLikeParams = Record<string, unknown> & {
  query: string
  shake?: boolean
}

export function compactSearchResult(entry: any) {
  return {
    resultId: entry.resultId,
    file: entry.file,
    startLine: entry.startLine,
    endLine: entry.endLine,
    symbolName: entry.symbolName,
    symbolType: entry.symbolType,
    type: entry.type,
    language: entry.language,
    parentScope: entry.parentScope,
    semanticKind: entry.semanticKind,
    framework: entry.framework,
    score: entry.score,
    rawDistance: entry.rawDistance,
    distanceMetric: entry.distanceMetric,
    confidence: entry.confidence,
    isWeakMatch: entry.isWeakMatch,
    whyMatched: entry.whyMatched,
    filterMatches: entry.filterMatches,
    estimatedTokens: entry.estimatedTokens,
    chunksMatched: entry.chunksMatched,
    snippetIntegrity: entry.snippetIntegrity,
    fileRole: entry.fileRole ?? entry.metadata?.fileRole,
  }
}

export function withActualOutputMetrics(payload: any): any {
  if (!payload?.budget || typeof payload.budget !== "object") return payload
  const attemptedOutputBytes = Number(payload.budget.attemptedOutputBytes ?? payload.budget.outputBytes ?? 0)
  const attemptedTokens = Number(payload.budget.attemptedTokens ?? payload.budget.emittedTokens ?? 0)
  let actualOutputBytes = 0
  let actualEmittedTokens = 0
  let measured = payload
  for (let iteration = 0; iteration < 10; iteration++) {
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
    const nextBytes = Buffer.byteLength(`${JSON.stringify(measured, null, 2)}\n`)
    const nextTokens = Math.ceil(nextBytes / 4)
    if (nextBytes === actualOutputBytes && nextTokens === actualEmittedTokens) return measured
    actualOutputBytes = nextBytes
    actualEmittedTokens = nextTokens
  }
  return {
    ...measured,
    budget: {
      ...measured.budget,
      actualOutputBytes,
      actualEmittedTokens,
      outputBytes: actualOutputBytes,
      emittedTokens: actualEmittedTokens,
    },
  }
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
    const jsonDetail = input.params.jsonDetail
    const includeRendered = input.flags["include-rendered-output"] === true || input.flags.includeRenderedOutput === true
    let payload: any
    if (jsonDetail === "compact") {
      const compactResults = Array.isArray(res.results)
        ? res.results.map(compactSearchResult)
        : res.results
      const { output: _output, results: _results, ...compact } = res
      payload = { ...compact, results: compactResults, ...(includeRendered ? { output: res.output } : {}) }
    } else if (jsonDetail === "summary" || jsonDetail === "representatives") {
      const { output: _output, ...compact } = res
      payload = includeRendered ? { ...compact, output: res.output } : compact
    } else {
      if (includeRendered || jsonDetail === "full") payload = res
      else {
        const { output: _output, ...withoutRendered } = res
        payload = withoutRendered
      }
    }
    writeJson(withActualOutputMetrics(payload))
    return
  }
  writeStdoutLine(res.output)
}
