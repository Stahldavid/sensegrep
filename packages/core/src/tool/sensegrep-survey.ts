import z from "zod"
import { Tool } from "./tool.js"
import {
  type CommonSensegrepParams,
  type SearchResources,
  type WorkingResult,
  collectWorkingResults,
  deriveDomainLabel,
  formatCodeFence,
  getImportHints,
  getQueryTokens,
  getSymbolTokens,
  selectRepresentatives,
  shakeRepresentativeResults,
  topCounts,
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

async function formatSurveyGroup(
  resources: SearchResources,
  group: SurveyGroup,
  perGroup: number,
  shake: boolean,
): Promise<string[]> {
  const lines: string[] = []
  const representatives = selectRepresentatives(group.members, perGroup)
  const importHints = topCounts(group.importHints, 3)
  const symbolHints = topCounts(group.symbolHints, 3)
  const symbolTypes = topCounts(group.dominantSymbolTypes, 3)

  lines.push(`## ${group.title}`)
  const metaParts = [`Hits: ${group.members.length}`, `Files: ${group.files.size}`]
  if (symbolTypes.length > 0) metaParts.push(`Symbols: ${symbolTypes.join(", ")}`)
  if (importHints.length > 0) metaParts.push(`Imports: ${importHints.join(", ")}`)
  if (symbolHints.length > 0) metaParts.push(`Signals: ${symbolHints.join(", ")}`)
  lines.push(metaParts.join(" | "))

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
        metadata: { matches: 0, indexed: true, groups: 0 },
        output: "No matching results found for your query.",
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
      outputLines.push(...(await formatSurveyGroup(resources, group, perGroup, params.shake !== false)))
    }

    return {
      title: params.query,
      metadata: {
        indexed: true,
        groups: groups.length,
        matches: rawResults.length,
        files: new Set(rawResults.map((result) => result.file)).size,
        shaked: params.shake !== false,
      },
      output: outputLines.join("\n"),
    }
  })
}

export const SenseGrepSurveyTool = Tool.define("sensegrep-survey", {
  description: DESCRIPTION,
  parameters: SurveyParametersSchema,
  execute: runSurvey,
})
