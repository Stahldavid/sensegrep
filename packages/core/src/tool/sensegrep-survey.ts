import z from "zod"
import { Tool } from "./tool.js"
import {
  type CommonSensegrepParams,
  type SearchResources,
  type WorkingResult,
  collectWorkingResults,
  deriveDomainLabel,
  formatCodeFence,
  getDominantSymbolPhrases,
  prependFreshnessWarning,
  getImportHints,
  getQueryTokens,
  getSymbolTokens,
  selectRepresentatives,
  shakeRepresentativeResults,
  topCounts,
  toStructuredSearchResult,
  withIndexedSearchResources,
} from "./sensegrep-pipeline.js"

const DESCRIPTION = [
  "Theme-oriented code survey using embeddings + AST metadata + optional literal fallback.",
  "Groups semantically related hits into reading domains such as middleware / guards, stores / state, services / api, and types / contracts.",
  "Returns representative tree-shaken snippets for each domain so you can onboard on a topic quickly.",
].join("\n")

const commonSearchShape = {
  query: z.string().describe("Natural language query to survey a domain or feature area"),
  pattern: z.string().optional().describe("Optional regex pattern to refine results"),
  include: z.string().optional().describe("File glob include filter"),
  exclude: z.string().optional().describe("File glob exclude filter"),
  minScore: z.number().optional().describe("Minimum relevance score 0-1"),
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
  limit: z.number().optional().describe("Maximum number of survey groups to return (default: 5)"),
  rawLimit: z.number().optional().describe("Maximum raw matches to retrieve before grouping (default: 60)"),
  perGroup: z.number().optional().describe("Representative snippets per group (default: 2)"),
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
  const reasons: string[] = []
  const imports = topCounts(group.importHints, 3)
  const symbols = topCounts(group.symbolHints, 3)
  const symbolTypes = topCounts(group.dominantSymbolTypes, 2)
  if (imports.length > 0) reasons.push(`shared imports/signals: ${imports.join(", ")}`)
  if (symbols.length > 0) reasons.push(`shared symbol terms: ${symbols.join(", ")}`)
  if (symbolTypes.length > 0) reasons.push(`dominant symbol types: ${symbolTypes.join(", ")}`)
  if (reasons.length === 0) reasons.push(`shared domain label: ${group.title}`)
  return reasons
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

  lines.push(`## ${chooseSurveyTitle(group, query)}`)
  const metaParts = [`Hits: ${group.members.length}`, `Files: ${group.files.size}`]
  if (symbolTypes.length > 0) metaParts.push(`Symbols: ${symbolTypes.join(", ")}`)
  if (importHints.length > 0) metaParts.push(`Imports: ${importHints.join(", ")}`)
  if (symbolHints.length > 0) metaParts.push(`Signals: ${symbolHints.join(", ")}`)
  lines.push(metaParts.join(" | "))
  lines.push(`Why grouped: ${getSurveyWhyGrouped(group).join(" | ")}`)

  if (shake) {
    const shaked = await shakeRepresentativeResults(resources, representatives)
    for (const fileResult of shaked) {
      const statsInfo =
        fileResult.stats.collapsedRegions > 0
          ? ` (${fileResult.stats.hiddenLines} lines hidden in ${fileResult.stats.collapsedRegions} regions)`
          : ""
      lines.push(`### ${fileResult.file}${statsInfo}`)
      const matchLabels = fileResult.originalResults
        .map((result) => [result.metadata.symbolName, result.metadata.symbolType].filter(Boolean).join(" "))
        .filter(Boolean)
      if (matchLabels.length > 0) {
        lines.push(`Matches: ${matchLabels.join(", ")}`)
      }
      lines.push(...formatCodeFence(fileResult.shakedContent, 100))
    }
  } else {
    for (const representative of representatives) {
      const symbolLabel = [representative.metadata.symbolName, representative.metadata.symbolType].filter(Boolean).join(", ")
      const heading = symbolLabel
        ? `${representative.file}:${representative.startLine} (${symbolLabel})`
        : `${representative.file}:${representative.startLine}-${representative.endLine}`
      lines.push(`### ${heading}`)
      lines.push(...formatCodeFence(representative.content, 40))
    }
  }

  lines.push("")
  return lines
}

async function runSurvey(params: SurveyParams) {
  return withIndexedSearchResources(params.query, async (resources) => {
    const limit = params.limit ?? 5
    const rawLimit = Math.max(params.rawLimit ?? 60, limit * 6)
    const perGroup = Math.max(1, params.perGroup ?? 2)
    const collected = await collectWorkingResults(resources, params as CommonSensegrepParams, {
      rawLimit,
      diversify: false,
    })

    if ("output" in collected) return collected
    const rawResults = collected.results.slice(0, rawLimit)
    if (rawResults.length === 0) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, groups: 0, freshness: resources.freshness },
        freshness: resources.freshness,
        output: prependFreshnessWarning("No matching results found for your query.", resources.freshness),
      }
    }

    const groups = buildSurveyGroups(rawResults, params.query).slice(0, limit)
    const outputLines = [
      `Survey for: ${params.query}`,
      "",
      `Found ${groups.length} groups from ${rawResults.length} matches across ${new Set(rawResults.map((result) => result.file)).size} files`,
      "",
    ]

    for (const group of groups) {
      outputLines.push(...(await formatSurveyGroup(resources, group, params.query, perGroup, params.shake !== false)))
    }

    return {
      title: params.query,
      metadata: {
        indexed: true,
        groups: groups.length,
        matches: rawResults.length,
        files: new Set(rawResults.map((result) => result.file)).size,
        shaked: params.shake !== false,
        freshness: resources.freshness,
      },
      freshness: resources.freshness,
      groups: groups.map((group) => ({
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
      })),
      output: prependFreshnessWarning(outputLines.join("\n"), resources.freshness),
    }
  })
}

export const SenseGrepSurveyTool = Tool.define("sensegrep-survey", {
  description: DESCRIPTION,
  parameters: SurveyParametersSchema,
  execute: runSurvey,
})
