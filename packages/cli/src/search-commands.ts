import {
  enforceAgentOutputBudget,
  projectAgentResponse,
  projectAgentResult,
  projectDuplicateAgentResponse,
  projectGraphAgentResponse,
  projectLiteralAgentResponse,
  projectSearchAgentResponse,
  projectShowAgentResponse,
  resolveAgentDetail,
  withAgentOutputMetrics,
  type AgentDetail,
} from "@sensegrep/core"
import { isPrettyJson, writeJson, writeStdoutLine } from "./output.js"
import { CliUsageError } from "./cli-errors.js"

export type Flags = Record<string, string | boolean>
export function parseJevOptions(flags: Flags) {
  const jev = flags.jev === undefined ? undefined : flags.jev === true ? "both" : String(flags.jev)
  if (jev !== undefined && !["off", "evidence", "rerank", "both"].includes(jev)) throw new CliUsageError("--jev must be off, evidence, rerank, or both")
  const integer = (name: string, min: number, max: number) => {
    if (flags[name] === undefined) return undefined
    const value = Number(flags[name])
    if (typeof flags[name] === "boolean" || !Number.isInteger(value) || value < min || value > max) throw new CliUsageError(`--${name} must be an integer from ${min} to ${max}`)
    return value
  }
  const panel = flags["jev-panel"]
  if (panel !== undefined && !["staged", "composite", "score", "noul"].includes(String(panel))) throw new CliUsageError("--jev-panel must be staged, composite, score, or noul")
  const ranking = flags["jev-ranking"]
  for (const name of ["jev-blocks", "jev-bundles", "jev-verify-aspects"]) if (flags[name] !== undefined && ![true,false,"true","false"].includes(flags[name])) throw new CliUsageError(`--${name} must be true or false`)
  const stages=flags['jev-stages']===undefined ? undefined : String(flags['jev-stages']).split(',')
  if(stages && (!stages.length || stages.some(s=>!['rerank','evidence','recovery'].includes(s)) || new Set(stages).size!==stages.length || !jev || jev==='off')) throw new CliUsageError('--jev-stages requires enabled --jev and unique comma-separated rerank,evidence,recovery stages')
  let jevAspects: string[] | undefined
  if (flags["jev-aspects"] !== undefined) {
    try {
      const parsed = JSON.parse(String(flags["jev-aspects"]))
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > 6 || parsed.some(v => typeof v !== "string" || !v.trim() || v.trim().length > 240)) throw new Error()
      jevAspects = parsed.map((v: string) => v.trim())
    } catch { throw new CliUsageError("--jev-aspects must be a JSON array of 1 to 6 nonempty strings, at most 240 characters each") }
  }
  if (ranking !== undefined && !["eligible", "legacy", "score", "rrf", "useful", "noul", "confidence-baseline"].includes(String(ranking))) throw new CliUsageError("--jev-ranking must be eligible, legacy, score, rrf, useful, noul, or confidence-baseline")
  return { jevPanel: panel as "staged" | "composite" | "score" | "noul" | undefined, jevBatchSize: integer("jev-batch-size", 1, 10), jevRanking: ranking as "eligible" | "legacy" | "score" | "rrf" | "useful" | "noul" | "confidence-baseline" | undefined,
    jev: jev as "off" | "evidence" | "rerank" | "both" | undefined,
    jevStages:stages as Array<'rerank'|'evidence'|'recovery'> | undefined,
    jevRecoveryDepth:integer('jev-recovery-depth',1,3), jevBeamWidth:integer('jev-beam-width',1,3),
    ...(flags['jev-verify-aspects']===undefined ? {} : {jevVerifyAspects:flags['jev-verify-aspects']===true || flags['jev-verify-aspects']==='true'}),
    jevAspects, ...(flags["jev-blocks"] === undefined ? {} : { jevBlocks: flags["jev-blocks"] === true || flags["jev-blocks"] === "true" }),
    ...(flags["jev-bundles"] === undefined ? {} : { jevBundles: flags["jev-bundles"] === true || flags["jev-bundles"] === "true" }),
    jevCandidates: integer("jev-candidates", 1, 80), jevTimeoutMs: integer("jev-timeout", 100, 60_000) }
}
type CoreModule = typeof import("@sensegrep/core")

export type SearchLikeParams = Record<string, unknown> & {
  query: string
  shake?: boolean
}

export type JsonProjection = AgentDetail

export const resolveJsonProjection = resolveAgentDetail

export function compactSearchResult(entry: any, includeFilterExplanations = false) {
  return projectAgentResult(entry, Number(entry.rank ?? 1), {
    detail: "minimal",
    includeFilterExplanations,
  })
}

export function projectSearchResponse(res: any, detail: JsonProjection, includeRendered = false, includeFilterExplanations = false): any {
  return projectSearchAgentResponse(res, {
    detail,
    diagnostics: detail === "diagnostic",
    includeRendered,
    includeFilterExplanations,
  })
}

export function projectDuplicateResponse(res: any, detail: JsonProjection, includeCode: boolean, limit?: number): any {
  if (limit !== undefined && res.duplicates.length > limit) {
    res = { ...res, status: "incomplete", duplicates: res.duplicates.slice(0, limit),
      summary: { ...res.summary, returnedDuplicates: limit, truncated: true, outputTruncated: true } }
  }
  return projectDuplicateAgentResponse(res, { detail, diagnostics: detail === "diagnostic", includeCode })
}

export function projectLiteralResponse(res: any, detail: JsonProjection): any {
  return projectLiteralAgentResponse(res, { detail, diagnostics: detail === "diagnostic" })
}

export function projectShowResponse(res: any, detail: JsonProjection, includeRendered = false): any {
  return projectShowAgentResponse(res, { detail, diagnostics: detail === "diagnostic", includeRendered })
}

export function projectGraphResponse(res: any, detail: JsonProjection): any {
  return projectGraphAgentResponse(res, { detail, diagnostics: detail === "diagnostic" })
}

export function withActualOutputMetrics(payload: any, pretty = isPrettyJson()): any {
  return withAgentOutputMetrics(payload, { pretty, trailingNewline: true })
}

export function enforceActualOutputBudget(payload: any, pretty = isPrettyJson()): any {
  return enforceAgentOutputBudget(payload, { pretty, trailingNewline: true })
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
  Object.assign(params, parseJevOptions(flags))

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
  assignNumberParam(params, flags, "maxOutputBytes", ["max-output-bytes", "maxOutputBytes"])
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
    const detail = resolveJsonProjection(jsonDetail, false)
    const payload = projectAgentResponse(rawResult, {
      detail,
      groupedDetail: jsonDetail === "representatives" || jsonDetail === "full" ? jsonDetail : "summary",
      diagnostics: input.flags.diagnostic === true || jsonDetail === "diagnostic",
      includeRendered,
      includeFilterExplanations: input.params.explainFilters === true,
    })
    if (typeof input.params.maxOutputBytes === "number") {
      payload.budget = { ...payload.budget, maxBytes: input.params.maxOutputBytes }
    }
    const finalPayload = enforceActualOutputBudget(payload)
    if (input.params.requireCoverage === true && finalPayload.coverageSatisfied === false) process.exitCode = 2
    writeJson(finalPayload)
    return
  }
  writeStdoutLine(res.output)
}
