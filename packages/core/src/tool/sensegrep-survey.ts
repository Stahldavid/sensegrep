import z from "zod"
import { Tool } from "./tool.js"
import {
  type CommonSensegrepParams,
  type SearchResources,
  type WorkingResult,
  deriveDomainLabel,
  formatGroupedResultHeader,
  formatRepresentativeSnippets,
  getDominantSymbolPhrases,
  getGroupingReasons,
  getImportHints,
  getQueryTokens,
  getSymbolTokens,
  runGroupedSearch,
  selectRepresentatives,
  topCounts,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"

const DESCRIPTION = [
  "Theme-oriented code survey using embeddings + AST metadata + optional literal fallback.",
  "Groups semantically related hits into reading domains such as middleware / guards, stores / state, services / api, and types / contracts.",
  "Returns representative tree-shaken snippets for each domain so you can onboard on a topic quickly.",
].join("\n")

const commonSearchShape = {
  query: z.string().trim().min(1).describe("Natural language query to survey a domain or feature area"),
  pattern: z.string().optional().describe("Optional regex pattern to refine results"),
  include: z.string().optional().describe("File glob include filter"),
  exclude: z.string().optional().describe("File glob exclude filter"),
  minScore: z.number().min(0).max(1).optional().describe("Minimum relevance score 0-1"),
  symbol: z.string().optional().describe("Filter by symbol name"),
  name: z.string().optional().describe('Alias for "symbol"'),
  symbolType: z
    .enum(["function", "class", "method", "type", "variable", "enum", "module"])
    .optional()
    .describe("Filter by semantic symbol type"),
  variant: z.string().optional().describe("Filter by language-specific variant"),
  decorator: z.string().optional().describe("Filter by decorator"),
  isExported: z.boolean().optional().describe("Only exported/public symbols"),
  isAsync: z.boolean().optional().describe("Only async functions/methods"),
  isStatic: z.boolean().optional().describe("Only static methods"),
  isAbstract: z.boolean().optional().describe("Only abstract classes/methods"),
  minComplexity: z.number().optional().describe("Minimum cyclomatic complexity"),
  maxComplexity: z.number().optional().describe("Maximum cyclomatic complexity"),
  hasDocumentation: z.boolean().optional().describe("Require documentation"),
  language: z.enum(["typescript", "javascript", "python", "java", "vue"]).optional().describe("Filter by language"),
  parentScope: z.string().optional().describe("Filter by parent scope/class"),
  imports: z.string().optional().describe("Filter by imported module name"),
  semanticKind: z.string().optional().describe('Filter by framework-aware kind (e.g. "convexMutation", "reactComponent")'),
  explainFilters: z.boolean().optional().describe("Include deterministic filter match explanations in JSON results"),
  strictParent: z.boolean().optional().describe("Require strict parent metadata when filtering by parent"),
  strictImports: z.boolean().optional().describe("Require strict import metadata when filtering by imports"),
  shake: z.boolean().default(true).describe("Enable tree-shaken representative snippets"),
} as const

const SurveyParametersSchema = z.object({
  ...commonSearchShape,
  limit: z.number().int().positive().max(100).optional().describe("Maximum number of survey groups to return (default: 5)"),
  rawLimit: z.number().int().positive().max(2000).optional().describe("Maximum raw matches to retrieve before grouping (default: 60)"),
  perGroup: z.number().int().positive().max(20).optional().describe("Representative snippets per group (default: 2)"),
})

type SurveyParams = z.infer<typeof SurveyParametersSchema>

type SurveyGroup = {
  title: string
  members: WorkingResult[]
  score: number
  files: Set<string>
  importHints: string[]
  symbolHints: string[]
  dominantSymbolTypes: string[]
}

const GENERIC_TITLE_SIGNALS = new Set(["api", "client", "clients", "service", "services", "types", "contracts", "model", "models"])

function buildSurveyGroups(results: WorkingResult[], query: string): SurveyGroup[] {
  const queryTokenSet = new Set(getQueryTokens(query))
  const groups = new Map<string, SurveyGroup>()

  for (const result of results) {
    const title = deriveDomainLabel(result)
    const group = groups.get(title) ?? {
      title,
      members: [],
      score: 0,
      files: new Set<string>(),
      importHints: [],
      symbolHints: [],
      dominantSymbolTypes: [],
    }

    group.members.push(result)
    group.score += result.semanticScore
    group.files.add(result.file)
    group.importHints.push(...getImportHints(result.metadata))
    group.symbolHints.push(...getSymbolTokens(result.metadata).filter((token) => !queryTokenSet.has(token)))
    const symbolType = typeof result.metadata.symbolType === "string" ? result.metadata.symbolType : ""
    if (symbolType) group.dominantSymbolTypes.push(symbolType)
    groups.set(title, group)
  }

  return [...groups.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.files.size !== a.files.size) return b.files.size - a.files.size
    return b.members.length - a.members.length
  })
}

function getRepresentativeTerms(group: SurveyGroup): string[] {
  return topCounts([...group.importHints, ...group.symbolHints, ...group.dominantSymbolTypes], 8)
}

function getSurveyWhyGrouped(group: SurveyGroup): string[] {
  return getGroupingReasons({
    fallback: `shared domain label: ${group.title}`,
    imports: group.importHints,
    symbols: group.symbolHints,
    symbolTypes: group.dominantSymbolTypes,
  })
}

function chooseSurveyTitle(group: SurveyGroup, query: string): string {
  const symbolPhrases = getDominantSymbolPhrases(group.members, query, 2, false)
  const symbolHints = topCounts(group.symbolHints, 2, new Set(getQueryTokens(query)))
  const importHints = topCounts(group.importHints, 2)
  const importSignal = importHints.find((hint) => !GENERIC_TITLE_SIGNALS.has(hint)) ?? importHints[0]
  const strongestSignal = importSignal && !GENERIC_TITLE_SIGNALS.has(importSignal)
    ? importSignal
    : symbolPhrases[0] ?? symbolHints[0] ?? importSignal

  if (!strongestSignal) return group.title
  if (group.title.includes(strongestSignal)) return group.title

  if (group.title === "related code" || group.title.startsWith("domain /")) {
    const base = group.title.startsWith("domain / ") ? group.title.slice("domain / ".length) : "related"
    return `${base} / ${strongestSignal}`
  }

  return `${group.title} / ${strongestSignal}`
}

async function formatSurveyGroup(
  resources: SearchResources,
  group: SurveyGroup,
  query: string,
  perGroup: number,
  shake: boolean,
): Promise<string[]> {
  const lines: string[] = []
  const representatives = selectRepresentatives(group.members, perGroup)
  const importHints = topCounts(group.importHints, 3)
  const symbolHints = topCounts(group.symbolHints, 3)
  const symbolTypes = topCounts(group.dominantSymbolTypes, 3)

  lines.push(...formatGroupedResultHeader({
    title: chooseSurveyTitle(group, query),
    hits: group.members.length,
    files: group.files.size,
    symbolTypes,
    imports: importHints,
    signals: symbolHints,
    whyGrouped: getSurveyWhyGrouped(group),
  }))

  lines.push(...(await formatRepresentativeSnippets(resources, representatives, { shake })))

  lines.push("")
  return lines
}

async function runSurvey(params: SurveyParams, ctx?: Tool.Context) {
  const perGroup = Math.max(1, params.perGroup ?? 2)
  return runGroupedSearch({
    params: params as CommonSensegrepParams & SurveyParams,
    heading: "Survey",
    groupLabel: "groups",
    resultKey: "groups",
    signal: ctx?.abort,
    defaultRawLimit: 60,
    rawLimitMultiplier: 6,
    buildGroups: (results) => buildSurveyGroups(results, params.query),
    formatGroup: (resources, group) => formatSurveyGroup(resources, group, params.query, perGroup, params.shake !== false),
    mapGroup: (group) => ({
        title: chooseSurveyTitle(group, params.query),
        score: Number(group.score.toFixed(6)),
        matches: group.members.length,
        files: [...group.files],
        imports: topCounts(group.importHints, 10),
        symbols: topCounts(group.symbolHints, 10),
        symbolTypes: topCounts(group.dominantSymbolTypes, 10),
        representativeTerms: getRepresentativeTerms(group),
        whyGrouped: getSurveyWhyGrouped(group),
        coverage: {
          files: group.files.size,
          symbols: new Set(group.members.map((member) => member.metadata.symbolName).filter(Boolean)).size,
        },
        results: group.members.map(toStructuredSearchResult),
      }),
  })
}

export const SenseGrepSurveyTool = Tool.define("sensegrep-survey", {
  description: DESCRIPTION,
  parameters: SurveyParametersSchema,
  execute: runSurvey,
})
