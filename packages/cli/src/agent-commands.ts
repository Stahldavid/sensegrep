import fs from "node:fs/promises"
import type { Flags } from "./search-commands.js"
import { writeJson, writeStderrLine, writeStdoutLine } from "./output.js"
import { CliUsageError } from "./cli-errors.js"

type Core = typeof import("@sensegrep/core")

function context() {
  return {
    sessionID: "cli",
    messageID: "cli",
    agent: "sensegrep-cli",
    abort: new AbortController().signal,
    metadata(_input: unknown) {},
  }
}

function positive(flags: Flags, key: string, fallback: number): number {
  const value = flags[key]
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new CliUsageError(`--${key} must be a positive integer`)
  return parsed
}

export async function runInvestigate(input: { query: string; flags: Flags; root: string; core: Core }) {
  const maxTokens = positive(input.flags, "max-tokens", 8_000)
  const plan = [
    { command: "search", reason: "behavioral discovery" },
    { command: "references+impact", reason: "caller and change-impact analysis for top symbols" },
    { command: "literal", reason: "deterministic evidence for the strongest symbol" },
    { command: "context", reason: "final token-bounded evidence pack" },
  ]
  if (input.flags["dry-run"] === true) {
    writeJson({ schemaVersion: 1, command: "investigate", status: "planned", query: input.query, plan, budget: { tokensRequested: maxTokens } })
    return
  }
  writeStderrLine(`Investigation plan: ${plan.map((step) => step.command).join(" -> ")}`)
  const searchTool = await input.core.SenseGrepTool.init()
  const literalTool = await input.core.SenseGrepLiteralTool.init()
  const contextTool = await input.core.SenseGrepContextTool.init()
  const search = await input.core.Instance.provide({
    directory: input.root,
    fn: () => searchTool.execute({ query: input.query, limit: 10, rerank: true, resultDetail: "compact" } as any, context()),
  })
  const symbols = [...new Set(((search as any).results ?? []).map((result: any) => result.symbolName).filter(Boolean))].slice(0, 3) as string[]
  const graph = await input.core.Instance.provide({
    directory: input.root,
    fn: async () => Promise.all(symbols.map(async (symbol) => ({
      symbol,
      references: await input.core.CodeGraph.findReferences(symbol, { limit: 50 }),
      impact: await input.core.CodeGraph.impact(symbol, { depth: 3, limit: 100 }),
    }))),
  })
  const literal = symbols[0]
    ? await input.core.Instance.provide({ directory: input.root, fn: () => literalTool.execute({ query: symbols[0], limit: 200, regex: false, caseSensitive: true } as any, context()) })
    : undefined
  const evidence = await input.core.Instance.provide({
    directory: input.root,
    fn: () => contextTool.execute({ query: input.query, maxTokens, limit: 50, rerank: true, resultDetail: "content" } as any, context()),
  })
  const discovery = input.core.projectAgentResponse(search, { detail: "minimal" })
  const literalEvidence = literal ? input.core.projectAgentResponse(literal, { detail: "minimal" }) : undefined
  const contextEvidence = input.core.enforceAgentOutputBudget(
    input.core.projectAgentResponse(evidence, { detail: "content" }),
    { trailingNewline: true },
  )
  const payload = {
    schemaVersion: 2,
    command: "investigate",
    status: "complete",
    plan,
    discovery,
    graph: graph.map((entry) => ({
      symbol: entry.symbol,
      references: input.core.projectAgentResponse({ ...entry.references, command: "references" }, { detail: "minimal" }),
      impact: input.core.projectAgentResponse({ ...entry.impact, command: "impact" }, { detail: "minimal" }),
    })),
    literal: literalEvidence,
    evidence: contextEvidence,
  }
  if (input.flags.json) writeJson(payload)
  else writeStdoutLine((evidence as any).output)
}

type EvalCase = { query: string; expectedFirstFiles: string[]; requiredSymbols: string[]; requiredKinds: string[] }

export function parseEvalCases(text: string): EvalCase[] {
  if (text.trim().startsWith("[")) return JSON.parse(text)
  const cases: EvalCase[] = []
  let current: EvalCase | undefined
  let listKey: keyof Omit<EvalCase, "query"> | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const query = line.match(/^-\s+query:\s*["']?(.*?)["']?$/)
    if (query) {
      current = { query: query[1], expectedFirstFiles: [], requiredSymbols: [], requiredKinds: [] }
      cases.push(current)
      listKey = undefined
      continue
    }
    const heading = line.match(/^(expectedFirstFiles|requiredSymbols|requiredKinds):\s*$/)
    if (heading && current) { listKey = heading[1] as keyof Omit<EvalCase, "query">; continue }
    const item = line.match(/^-\s+["']?(.*?)["']?$/)
    if (item && current && listKey) current[listKey].push(item[1])
  }
  if (cases.length === 0 || cases.some((entry) => !entry.query)) throw new Error("Eval file contains no valid cases.")
  return cases
}

export async function runEval(input: { file: string; flags: Flags; root: string; core: Core }) {
  const cases = parseEvalCases(await fs.readFile(input.file, "utf8"))
  const limit = positive(input.flags, "limit", 10)
  const tool = await input.core.SenseGrepTool.init()
  const results = []
  for (const entry of cases) {
    const startedAt = Date.now()
    const response = await input.core.Instance.provide({
      directory: input.root,
      fn: () => tool.execute({ query: entry.query, limit, rerank: true } as any, context()),
    }) as any
    const hits = response.results ?? []
    const relevantRanks = hits.map((hit: any, index: number) => ({ hit, rank: index + 1 })).filter(({ hit }: any) =>
      entry.expectedFirstFiles.includes(hit.file) || entry.requiredSymbols.includes(hit.symbolName) || entry.requiredKinds.includes(hit.semanticKind),
    )
    const required = entry.expectedFirstFiles.length + entry.requiredSymbols.length + entry.requiredKinds.length
    const found = entry.expectedFirstFiles.filter((file) => hits.some((hit: any) => hit.file === file)).length
      + entry.requiredSymbols.filter((symbol) => hits.some((hit: any) => hit.symbolName === symbol)).length
      + entry.requiredKinds.filter((kind) => hits.some((hit: any) => hit.semanticKind === kind)).length
    results.push({
      query: entry.query,
      recallAtLimit: required === 0 ? 1 : found / required,
      firstRelevantRank: relevantRanks[0]?.rank ?? null,
      structuralPrecision: hits.length === 0 ? 0 : relevantRanks.length / hits.length,
      tokensUsed: response.budget?.tokensUsed ?? response.metrics?.estimatedOutputTokens ?? 0,
      latencyMs: Date.now() - startedAt,
      passed: required === 0 || found === required,
    })
  }
  const summary = {
    cases: results.length,
    passed: results.filter((entry) => entry.passed).length,
    recallAtLimit: results.reduce((sum, entry) => sum + entry.recallAtLimit, 0) / results.length,
    meanFirstRelevantRank: results.filter((entry) => entry.firstRelevantRank !== null).reduce((sum, entry) => sum + Number(entry.firstRelevantRank), 0) / Math.max(1, results.filter((entry) => entry.firstRelevantRank !== null).length),
    tokensUsed: results.reduce((sum, entry) => sum + entry.tokensUsed, 0),
    latencyMs: results.reduce((sum, entry) => sum + entry.latencyMs, 0),
  }
  writeJson({ schemaVersion: 1, command: "eval", status: summary.passed === summary.cases ? "complete" : "failed", summary, results })
  if (summary.passed !== summary.cases) process.exitCode = 2
}
