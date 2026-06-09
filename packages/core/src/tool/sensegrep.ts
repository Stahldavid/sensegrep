import z from "zod"
import { readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { once } from "node:events"
import picomatch from "picomatch"
import { Tool } from "./tool.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { Ripgrep } from "../file/ripgrep.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import { Log } from "../util/log.js"
import path from "path"
import {
  annotateWorkingResults,
  getFreshnessSummary,
  prependFreshnessWarning,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"

const DESCRIPTION = readFileSync(new URL("./sensegrep.txt", import.meta.url), "utf8")
const log = Log.create({ service: "tool.sensegrep" })

const MAX_LINE_LENGTH = 2000

// Batch ripgrep file arguments to avoid command line length limits (notably on Windows).
const RIPGREP_MAX_ARG_CHARS = process.platform === "win32" ? 7000 : 30000
const RIPGREP_MAX_FILES_PER_BATCH = 256

// Extensions used to prioritize code matches over docs/config in the literal fallback.
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".rb", ".php", ".swift", ".kt", ".scala", ".vue", ".svelte"
])

function isCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return CODE_EXTENSIONS.has(ext)
}

function normalizeFilePath(file: string): string {
  return file.replace(/\\/g, "/")
}

function canonicalizeProjectFilePath(file: string): string {
  let normalized = normalizeFilePath(file)
  const normalizedRoot = normalizeFilePath(path.resolve(Instance.directory))

  if (path.isAbsolute(file)) {
    const absolutePath = normalizeFilePath(path.resolve(file))
    const rootWithSlash = `${normalizedRoot}/`
    if (absolutePath.toLowerCase().startsWith(rootWithSlash.toLowerCase())) {
      normalized = absolutePath.slice(rootWithSlash.length)
    } else {
      normalized = absolutePath
    }
  }

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2)
  }

  return normalized
}

function expandFilePathVariants(file: string): string[] {
  const canonical = canonicalizeProjectFilePath(file)
  const variants = new Set<string>([
    file,
    normalizeFilePath(file),
    canonical,
    canonical.replace(/\//g, "\\"),
  ])

  if (canonical && !canonical.startsWith("./")) {
    variants.add(`./${canonical}`)
    variants.add(`.\\${canonical.replace(/\//g, "\\")}`)
  }

  return [...variants].filter(Boolean)
}

function createGlobMatcher(pattern: string) {
  const normalizedPattern = canonicalizeProjectFilePath(pattern)
  const hasPathSeparator = normalizedPattern.includes("/")
  return picomatch(normalizedPattern, {
    dot: true,
    // Treat "*.ts" like a repo-wide basename match instead of only matching root files.
    basename: !hasPathSeparator,
  })
}

function expandImportFilterValues(imports: string): string[] {
  const values = new Set<string>()
  for (const raw of imports.split(",")) {
    const cleaned = raw.trim().replace(/^['"`]|['"`]$/g, "")
    if (!cleaned) continue
    values.add(cleaned)

    const withoutScopePrefix = cleaned.startsWith("@") ? cleaned.slice(1) : cleaned
    if (withoutScopePrefix !== cleaned) values.add(withoutScopePrefix)

    const parts = withoutScopePrefix.split(/[\\/]/).filter(Boolean)
    const last = parts.at(-1)
    if (last) values.add(last)
  }
  return [...values]
}

function getScopedFilePath(file: string, subdirPrefix?: string): string | undefined {
  const normalizedFile = canonicalizeProjectFilePath(file)
  if (!subdirPrefix) return normalizedFile

  const normalizedPrefix = normalizeFilePath(subdirPrefix).replace(/^\.\//, "").replace(/\/$/, "")
  if (normalizedFile === normalizedPrefix) return ""
  const prefixWithSlash = `${normalizedPrefix}/`
  if (!normalizedFile.toLowerCase().startsWith(prefixWithSlash.toLowerCase())) return undefined
  return normalizedFile.slice(prefixWithSlash.length)
}

function matchesScopedGlob(
  file: string,
  matcher: ReturnType<typeof createGlobMatcher> | undefined,
  subdirPrefix?: string,
): boolean {
  if (!matcher) return true
  const projectPath = canonicalizeProjectFilePath(file)
  const scopedPath = getScopedFilePath(file, subdirPrefix)
  return matcher(projectPath) || (scopedPath !== undefined && matcher(scopedPath))
}

// Helper: Run ripgrep only on specific files (post-filter approach)
async function runRipgrepOnFiles(
  pattern: string,
  files: string[],
  options?: {
    caseSensitive?: boolean
    fixedStrings?: boolean
  },
): Promise<{ file: string; line: number; text: string }[]> {
  if (files.length === 0) return []

  const rgPath = await Ripgrep.filepath()
  const matches: { file: string; line: number; text: string }[] = []

  // Use repo-relative paths together with cwd so each argument stays short.
  const normalizedFiles = files.map((file) => canonicalizeProjectFilePath(file))
  const fileBatches: string[][] = []
  let currentBatch: string[] = []
  let currentChars = 0

  for (const file of normalizedFiles) {
    const estimatedChars = file.length + 1
    const wouldOverflow =
      currentBatch.length > 0 &&
      (currentBatch.length >= RIPGREP_MAX_FILES_PER_BATCH || currentChars + estimatedChars > RIPGREP_MAX_ARG_CHARS)

    if (wouldOverflow) {
      fileBatches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(file)
    currentChars += estimatedChars
  }

  if (currentBatch.length > 0) fileBatches.push(currentBatch)

  for (const batch of fileBatches) {
    const args: string[] = [
      "-n", // Line numbers
      "--no-heading", // Simple format: file:line:text
    ]

    if (!options?.caseSensitive) args.push("-i")
    if (options?.fixedStrings) {
      args.push("--fixed-strings", pattern)
    } else {
      args.push("--regexp", pattern)
    }

    // "--" guards against file paths that could be parsed as flags.
    args.push("--", ...batch)

    const proc = spawn(rgPath, args, {
      cwd: Instance.directory,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    const [code] = (await once(proc, "close")) as [number]
    if (code && code !== 1) {
      throw new Error(`ripgrep failed with code ${code}: ${stderr}`)
    }

    // Parse output: "file:line:text"
    for (const line of output.trim().split("\n")) {
      if (!line) continue
      const match = line.match(/^(.*):(\d+):(.*)$/)
      if (match) {
        const [, matchedPath, lineNum, text] = match
        matches.push({
          file: canonicalizeProjectFilePath(matchedPath),
          line: parseInt(lineNum, 10),
          text: text.trim(),
        })
      }
    }
  }

  return matches
}

function queryLooksLikeIdentifier(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 3 || trimmed.length > 120) return false
  if (/\s/.test(trimmed)) return false
  if (!/^[A-Za-z_$][A-Za-z0-9_$.:#-]*$/.test(trimmed)) return false
  if (!/[A-Za-z]/.test(trimmed)) return false

  return (
    /[A-Z]/.test(trimmed.slice(1)) ||
    trimmed.includes("_") ||
    trimmed.includes("-") ||
    trimmed.includes(".") ||
    /^(use|define|get|set|is|has)[A-Z_]/.test(trimmed)
  )
}

function buildFiltersWithFileVariants(
  filters: VectorStore.SearchFilters,
  filePath: string,
): VectorStore.SearchFilters {
  return {
    ...filters,
    all: [...(filters.all ?? []), { key: "file", operator: "in", value: expandFilePathVariants(filePath) }],
  }
}

function pickBestLiteralDocument(
  documents: Awaited<ReturnType<typeof VectorStore.listDocuments>>,
  matchedLine: number,
) {
  const candidates = documents.filter((doc) => {
    const file = canonicalizeProjectFilePath(doc.metadata.file as string)
    const startLine = doc.metadata.startLine as number
    const endLine = doc.metadata.endLine as number
    return file && matchedLine >= startLine && matchedLine <= endLine
  })

  if (candidates.length === 0) return undefined

  return candidates.sort((a, b) => {
    const aHasSymbol = a.metadata.symbolType ? 1 : 0
    const bHasSymbol = b.metadata.symbolType ? 1 : 0
    if (aHasSymbol !== bHasSymbol) return bHasSymbol - aHasSymbol

    const aLen = Number(a.metadata.endLine ?? 0) - Number(a.metadata.startLine ?? 0)
    const bLen = Number(b.metadata.endLine ?? 0) - Number(b.metadata.startLine ?? 0)
    return aLen - bLen
  })[0]
}

async function collectRipgrepFallbackResults(
  pattern: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
  options?: {
    caseSensitive?: boolean
    fixedStrings?: boolean
    semanticScore?: number
  },
): Promise<
  {
    id: string
    file: string
    content: string
    startLine: number
    endLine: number
    semanticScore: number
    metadata: Record<string, string | number | boolean | string[] | undefined>
  }[]
> {
  const rgMatches = await runRipgrepOnFiles(pattern, files, {
    caseSensitive: options?.caseSensitive,
    fixedStrings: options?.fixedStrings,
  })
  if (rgMatches.length === 0) return []

  const byFile = new Map<string, { line: number; text: string }[]>()
  for (const match of rgMatches) {
    const canonicalFile = canonicalizeProjectFilePath(match.file)
    const list = byFile.get(canonicalFile) ?? []
    list.push({ line: match.line, text: match.text })
    byFile.set(canonicalFile, list)
  }

  const results = new Map<
    string,
    {
      id: string
      file: string
      content: string
      startLine: number
      endLine: number
      semanticScore: number
      rawDistance?: number
      distanceMetric?: VectorStore.DistanceMetric
      metadata: Record<string, string | number | boolean | string[] | undefined>
      isCode: boolean
    }
  >()

  // Collect all candidates first
  for (const [file, fileMatches] of byFile.entries()) {
    const documents = await VectorStore.listDocuments(collection, {
      filters: buildFiltersWithFileVariants(filters, file),
    })

    for (const fileMatch of fileMatches) {
      const selected = pickBestLiteralDocument(documents, fileMatch.line)
      if (!selected) continue

      const key = `${selected.metadata.file}:${selected.metadata.startLine}:${selected.metadata.endLine}`
      if (results.has(key)) continue

      results.set(key, {
        id: selected.id,
        file: selected.metadata.file as string,
        content: selected.content,
        startLine: selected.metadata.startLine as number,
        endLine: selected.metadata.endLine as number,
        semanticScore: options?.semanticScore ?? 1.04,
        metadata: selected.metadata,
        isCode: isCodeFile(selected.metadata.file as string),
      })
    }
  }

  // Prioritize code files over docs/config
  const resultArray = [...results.values()]
  const codeResults = resultArray.filter((r) => r.isCode)
  const nonCodeResults = resultArray.filter((r) => !r.isCode)

  // Return code results first, then non-code results
  return [...codeResults, ...nonCodeResults]
}

async function collectLiteralFallbackResults(
  query: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
) {
  return collectRipgrepFallbackResults(query, files, collection, filters, {
    caseSensitive: true,
    fixedStrings: true,
    semanticScore: 1.05,
  })
}

function overlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1)
  const lenA = Math.max(1, aEnd - aStart + 1)
  const lenB = Math.max(1, bEnd - bStart + 1)
  const minLen = Math.min(lenA, lenB)
  return overlap / minLen
}

function dedupeOverlapping<T extends {
  file: string
  startLine: number
  endLine: number
  semanticScore: number
  metadata: Record<string, unknown>
}>(results: T[], options?: { overlapThreshold?: number; scoreSlack?: number }): T[] {
  const overlapThreshold = options?.overlapThreshold ?? 0.6
  const scoreSlack = options?.scoreSlack ?? 0.02
  const byFile = new Map<string, T[]>()
  const kept: T[] = []

  for (const result of results) {
    const list = byFile.get(result.file) ?? []
    let replaced = false
    let skip = false

    for (let i = 0; i < list.length; i++) {
      const existing = list[i]
      const ratio = overlapRatio(result.startLine, result.endLine, existing.startLine, existing.endLine)
      if (ratio < overlapThreshold) continue

      const scoreDiff = result.semanticScore - existing.semanticScore
      const resultType = String(result.metadata.symbolType ?? "")
      const existingType = String(existing.metadata.symbolType ?? "")
      const resultLen = result.endLine - result.startLine + 1
      const existingLen = existing.endLine - existing.startLine + 1

      let preferResult = scoreDiff > scoreSlack
      if (!preferResult && Math.abs(scoreDiff) <= scoreSlack) {
        if (resultType === "method" && existingType === "class") {
          preferResult = true
        } else if (resultType === "function" && existingType === "class") {
          preferResult = true
        } else if (resultLen < existingLen) {
          preferResult = true
        }
      }

      if (preferResult) {
        list[i] = result
        replaced = true
      } else {
        skip = true
      }
      break
    }

    if (!skip) {
      if (!replaced) list.push(result)
      byFile.set(result.file, list)
    }
  }

  for (const list of byFile.values()) {
    kept.push(...list)
  }

  return kept
}

function diversifyResults<T extends {
  file: string
  metadata: Record<string, unknown>
}>(results: T[], limits: { maxPerFile: number; maxPerSymbol: number }): T[] {
  const { maxPerFile, maxPerSymbol } = limits
  const kept: T[] = []
  const perFile = new Map<string, number>()
  const perSymbol = new Map<string, number>()

  for (const result of results) {
    const file = result.file || ""
    const symbolName = typeof result.metadata.symbolName === "string" ? result.metadata.symbolName : ""

    if (maxPerFile > 0) {
      const fileCount = perFile.get(file) ?? 0
      if (fileCount >= maxPerFile) continue
      perFile.set(file, fileCount + 1)
    }

    if (maxPerSymbol > 0 && symbolName) {
      const symbolCount = perSymbol.get(symbolName) ?? 0
      if (symbolCount >= maxPerSymbol) continue
      perSymbol.set(symbolName, symbolCount + 1)
    }

    kept.push(result)
  }

  return kept
}

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Natural language query to search for semantically similar code/content"),
    pattern: z.string().optional().describe("Optional regex pattern for keyword matching (BM25-style)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
    maxPerFile: z.number().optional().describe("Maximum results per file (default: 2)"),
    maxPerSymbol: z.number().optional().describe("Maximum results per symbol (default: 2)"),

    include: z.string().optional().describe('File glob include filter (e.g. "*.ts", "src/**/*.tsx")'),
    exclude: z.string().optional().describe('File glob exclude filter (e.g. "*.md", "docs/**")'),
    rerank: z.boolean().default(false).describe("Compatibility flag. Remote-only mode does not perform reranking."),
    minScore: z.number().optional().describe("Minimum relevance score 0-1 (filters low-confidence results)"),
    symbol: z.string().optional().describe('Filter by symbol name (e.g. "VectorStore")'),
    name: z.string().optional().describe('Alias for "symbol"'),


    // Semantic metadata filters
    symbolType: z
      .enum(["function", "class", "method", "type", "variable", "enum", "module"])
      .optional()
      .describe('Filter by semantic symbol type (universal across languages)'),
    variant: z
      .string()
      .optional()
      .describe('Filter by symbol variant (e.g. "interface", "dataclass", "async", "static")'),
    isExported: z.boolean().optional().describe("Filter for exported/public symbols only"),
    isAsync: z.boolean().optional().describe("Filter for async functions/methods"),
    isStatic: z.boolean().optional().describe("Filter for static methods"),
    isAbstract: z.boolean().optional().describe("Filter for abstract classes/methods"),
    decorator: z.string().optional().describe('Filter by decorator (e.g. "@property", "@dataclass")'),
    minComplexity: z.number().optional().describe("Minimum cyclomatic complexity (e.g. 5 for moderately complex code)"),
    maxComplexity: z.number().optional().describe("Maximum cyclomatic complexity"),
    hasDocumentation: z.boolean().optional().describe("Filter for code with/without documentation"),
    language: z
      .enum(["typescript", "javascript", "python", "java", "vue"])
      .optional()
      .describe('Filter by programming language'),
    parentScope: z.string().optional().describe('Filter by parent scope/class (e.g. "VectorStore")'),
    imports: z.string().optional().describe('Filter by imported module name (e.g. "react")'),
    semanticKind: z.string().optional().describe('Filter by framework-aware kind (e.g. "convexMutation", "reactComponent", "routeHandler")'),
    explainFilters: z.boolean().optional().describe("Include deterministic filter match explanations in JSON results"),
    strictParent: z.boolean().optional().describe("Require strict parent metadata when filtering by parent"),
    strictImports: z.boolean().optional().describe("Require strict import metadata when filtering by imports"),
    shake: z.boolean().default(true).describe("Enable semantic tree-shaking to show full file context with irrelevant regions collapsed (default: true)"),
  }),
  async execute(params, _ctx): Promise<Tool.Result<Record<string, unknown>>> {
    // Read index metadata first (before any embedding initialization)
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta.embeddings) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: false },
        results: [],
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    const meta = resolved.meta

    // Configure embeddings to match the index
    const indexConfig = {
      provider: meta.embeddings.provider,
      embedModel: meta.embeddings.model,
      embedDim: meta.embeddings.dimension,
    }

    const run = async () => {
    // Clear any cached tables that might have wrong dimension expectations
    VectorStore.clearProjectCache(resolved.root)
    const freshness = await getFreshnessSummary()

    const limit = params.limit ?? 10
    const shouldRerank = params.rerank === true

    // Get collection, passing the expected dimension from index metadata
    const collection = await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)

    // Build semantic filters from parameters
    const filters: VectorStore.SearchFilters = { all: [] }

    if (params.symbolType) {
      filters.all!.push({ key: "symbolType", operator: "equals", value: params.symbolType })
    }

    if (params.isExported !== undefined) {
      filters.all!.push({ key: "isExported", operator: "equals", value: params.isExported })
    }

    if (params.minComplexity !== undefined) {
      filters.all!.push({ key: "complexity", operator: "greater_or_equal", value: params.minComplexity })
    }

    if (params.maxComplexity !== undefined) {
      filters.all!.push({ key: "complexity", operator: "less_or_equal", value: params.maxComplexity })
    }

    if (params.hasDocumentation !== undefined) {
      filters.all!.push({ key: "hasDocumentation", operator: "equals", value: params.hasDocumentation })
    }

    if (params.language) {
      filters.all!.push({ key: "language", operator: "equals", value: params.language })
    }

    // New multilingual filters
    if (params.variant) {
      filters.all!.push({ key: "variant", operator: "equals", value: params.variant })
    }

    if (params.isAsync !== undefined) {
      filters.all!.push({ key: "isAsync", operator: "equals", value: params.isAsync })
    }

    if (params.isStatic !== undefined) {
      filters.all!.push({ key: "isStatic", operator: "equals", value: params.isStatic })
    }

    if (params.isAbstract !== undefined) {
      filters.all!.push({ key: "isAbstract", operator: "equals", value: params.isAbstract })
    }

    if (params.decorator) {
      filters.all!.push({ key: "decorators", operator: "contains", value: params.decorator })
    }

    if (params.parentScope) {
      filters.all!.push({ key: "parentScope", operator: "contains", value: params.parentScope })
    }
    if ((params as any).semanticKind) {
      filters.all!.push({ key: "semanticKind", operator: "equals", value: (params as any).semanticKind })
    }
    if (params.imports) {
      const importValues = expandImportFilterValues(params.imports)
      if (importValues.length === 1) {
        filters.all!.push({ key: "imports", operator: "contains", value: importValues[0] })
      } else if (importValues.length > 1) {
        filters.any = [
          ...(filters.any ?? []),
          ...importValues.map((value) => ({ key: "imports", operator: "contains" as const, value })),
        ]
      }
    }
    const symbolQuery = params.symbol ?? params.name
    if (symbolQuery) {
      filters.all!.push({ key: "symbolName", operator: "contains", value: symbolQuery })
    }

    let includeMatcher: ReturnType<typeof createGlobMatcher> | undefined
    let excludeMatcher: ReturnType<typeof createGlobMatcher> | undefined
    if (params.include) includeMatcher = createGlobMatcher(params.include)
    if (params.exclude) excludeMatcher = createGlobMatcher(params.exclude)

    let candidateFiles: string[] | undefined
    if (includeMatcher || excludeMatcher || resolved.subdirPrefix) {
      const indexedFiles = Object.keys(meta.files ?? {})
      candidateFiles = indexedFiles.filter((file) => {
        if (getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
        if (!matchesScopedGlob(file, includeMatcher, resolved.subdirPrefix)) return false
        if (excludeMatcher && matchesScopedGlob(file, excludeMatcher, resolved.subdirPrefix)) return false
        return true
      })

      if (candidateFiles.length === 0) {
        const filterLabel = [
          params.include ? `include="${params.include}"` : null,
          params.exclude ? `exclude="${params.exclude}"` : null,
          resolved.subdirPrefix ? `scope="${resolved.subdirPrefix}"` : null,
        ]
          .filter(Boolean)
          .join(", ")
        return {
          title: params.query,
          metadata: { matches: 0, indexed: true, freshness },
          freshness,
          results: [],
          output: prependFreshnessWarning(
            `No indexed files matched the file filters${filterLabel ? ` (${filterLabel})` : ""}.`,
            freshness,
          ),
        }
      }

      const fileFilterValues = [...new Set(candidateFiles.flatMap((file) => expandFilePathVariants(file)))]
      filters.all!.push({ key: "file", operator: "in", value: fileFilterValues })
    }

    // Only pass filters if we have any
    const searchOptions: { limit: number; filters?: VectorStore.SearchFilters } = {
      limit: params.pattern ? limit * 3 : limit * 2, // Get more if we need to post-filter
    }
    if ((filters.all && filters.all.length > 0) || (filters.any && filters.any.length > 0)) {
      searchOptions.filters = filters
    }

    // Step 1: Semantic search with metadata filters
    let semanticResults = await VectorStore.search(collection, params.query, searchOptions)

    // Apply file globs again as a safety net after semantic search.
    if (includeMatcher) {
      semanticResults = semanticResults.filter((r) =>
        matchesScopedGlob(r.metadata.file as string, includeMatcher, resolved.subdirPrefix),
      )
    }
    if (excludeMatcher) {
      semanticResults = semanticResults.filter((r) =>
        !matchesScopedGlob(r.metadata.file as string, excludeMatcher, resolved.subdirPrefix),
      )
    }

    const shouldRunLiteralFallback = !params.pattern && queryLooksLikeIdentifier(params.query)
    let literalFallbackResults: WorkingResult[] = []
    const lexicalCandidateFiles =
      shouldRunLiteralFallback || params.pattern
        ? candidateFiles ??
          Object.keys(meta.files ?? {}).filter((file) => {
            if (getScopedFilePath(file, resolved.subdirPrefix) === undefined) return false
            if (!matchesScopedGlob(file, includeMatcher, resolved.subdirPrefix)) return false
            if (excludeMatcher && matchesScopedGlob(file, excludeMatcher, resolved.subdirPrefix)) return false
            return true
          })
        : []

    if (shouldRunLiteralFallback) {
      const literalResults = await collectLiteralFallbackResults(params.query, lexicalCandidateFiles, collection, filters)
      literalFallbackResults = literalResults.map((result) => ({
        file: result.file,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
        semanticScore: result.semanticScore,
        metadata: result.metadata,
      }))
    }

    // Step 2: Post-filter with ripgrep if pattern provided
    // This runs ripgrep ONLY on files found by semantic search
    let filteredResults = semanticResults
    if (params.pattern && semanticResults.length > 0) {
      const uniqueFiles = [...new Set(semanticResults.map((r) => r.metadata.file as string))]
      const rgMatches = await runRipgrepOnFiles(params.pattern, uniqueFiles)

      // Keep only chunks that contain ripgrep matches (line within chunk range)
      filteredResults = semanticResults.filter((r) => {
        const file = canonicalizeProjectFilePath(r.metadata.file as string)
        const startLine = r.metadata.startLine as number
        const endLine = r.metadata.endLine as number
        return rgMatches.some((m) => m.file === file && m.line >= startLine && m.line <= endLine)
      })
    }

    let patternFallbackResults: WorkingResult[] = []
    if (params.pattern) {
      const patternResults = await collectRipgrepFallbackResults(
        params.pattern,
        lexicalCandidateFiles,
        collection,
        filters,
        { semanticScore: 1.04 },
      )
      patternFallbackResults = patternResults.map((result) => ({
        file: result.file,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
        semanticScore: result.semanticScore,
        metadata: result.metadata,
      }))
    }

    // Convert to working format with semantic score
    type WorkingResult = {
      file: string
      content: string
      startLine: number
      endLine: number
      semanticScore: number
      rawDistance?: number
      distanceMetric?: VectorStore.DistanceMetric
      metadata: Record<string, string | number | boolean | string[] | undefined>
      rerankScore?: number
      confidence?: "high" | "medium" | "low"
      isWeakMatch?: boolean
      whyMatched?: string[]
      filterMatches?: Record<string, unknown>
    }
    let workingResults: WorkingResult[] = filteredResults.map((r) => ({
      file: r.metadata.file as string,
      content: r.content,
      startLine: r.metadata.startLine as number,
      endLine: r.metadata.endLine as number,
      semanticScore: VectorStore.distanceToSimilarity(r.distance, VectorStore.getDistanceMetric(meta)),
      rawDistance: r.distance,
      distanceMetric: VectorStore.getDistanceMetric(meta),
      metadata: r.metadata,
    }))

    const fallbackResults = [...literalFallbackResults, ...patternFallbackResults]
    if (fallbackResults.length > 0) {
      const merged = new Map<string, WorkingResult>()

      for (const result of workingResults) {
        const key = `${result.file}:${result.startLine}:${result.endLine}`
        merged.set(key, result)
      }

      for (const result of fallbackResults) {
        const key = `${result.file}:${result.startLine}:${result.endLine}`
        const existing = merged.get(key)
        if (existing) {
          merged.set(key, {
            ...existing,
            semanticScore: Math.max(existing.semanticScore, result.semanticScore),
          })
        } else {
          merged.set(key, result)
        }
      }

      workingResults = [...merged.values()]
    }

    workingResults = annotateWorkingResults(workingResults, params as any)

    // Sort by semantic score initially
    workingResults.sort((a, b) => b.semanticScore - a.semanticScore)

    // Optional rerank (cross-encoder) on top-N candidates
    let rankedResults = workingResults
    if (shouldRerank && workingResults.length > 1) {
      log.warn("rerank requested but reranking is disabled in remote-only mode")
    }

    const minScore = typeof params.minScore === "number" ? params.minScore : undefined
    if (minScore !== undefined) {
      rankedResults = rankedResults.filter((r) => (r.rerankScore ?? r.semanticScore) >= minScore)
    }

    // Dedupe overlapping results within the same file (class vs method, etc.)
    const dedupedResults = dedupeOverlapping(rankedResults)

    // Enforce diversity across file/symbol to avoid repeating the same source
    const maxPerFile = typeof params.maxPerFile === "number" ? Math.max(0, params.maxPerFile) : 2
    const maxPerSymbol = typeof params.maxPerSymbol === "number" ? Math.max(0, params.maxPerSymbol) : 2
    const diversifiedResults = diversifyResults(dedupedResults, { maxPerFile, maxPerSymbol })

    // Take top results
    const finalResults = diversifiedResults.slice(0, limit)

    if (finalResults.length === 0) {
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, freshness },
        freshness,
        results: [],
        output: prependFreshnessWarning("No matching results found for your query.", freshness),
      }
    }

    // Apply semantic tree-shaking if enabled (default: true)
    const shouldShake = params.shake !== false
    
    if (shouldShake) {
      // Get pre-computed collapsible regions from the index
      const indexMeta = await VectorStore.readIndexMeta(Instance.directory)
      const precomputedRegionsMap = new Map<string, TreeShaker.CollapsibleRegion[]>()
      
      if (indexMeta?.files) {
        // Build map of file -> collapsible regions
        for (const result of finalResults) {
          const fileStat = indexMeta.files[result.file]
          if (fileStat?.collapsibleRegions) {
            precomputedRegionsMap.set(result.file, fileStat.collapsibleRegions as TreeShaker.CollapsibleRegion[])
          }
        }
      }

      // Group results by file and apply tree-shaking
      const shakedResults = await TreeShaker.shakeResults(
        finalResults.map((r) => ({
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          content: r.content,
          metadata: r.metadata as Record<string, unknown>,
        })),
        Instance.directory,
        precomputedRegionsMap.size > 0 ? precomputedRegionsMap : undefined
      )

      // Format output with shaked content
      const outputLines = [`Found ${finalResults.length} results across ${shakedResults.length} files\n`]

      for (const shaked of shakedResults) {
        // File header with stats
        const statsInfo = shaked.stats.collapsedRegions > 0
          ? ` (${shaked.stats.hiddenLines} lines hidden in ${shaked.stats.collapsedRegions} regions)`
          : ""
        outputLines.push(`## ${shaked.file}${statsInfo}`)

        // Show metadata for the relevant matches in this file
        const metaParts: string[] = []
        for (const result of shaked.originalResults) {
          const meta = result.metadata
          const symbolInfo = [meta.symbolName, meta.symbolType].filter(Boolean).join(" ")
          const kindInfo = typeof meta.semanticKind === "string" && meta.semanticKind ? ` (${meta.semanticKind})` : ""
          if (symbolInfo) metaParts.push(`${symbolInfo}${kindInfo}`)
        }
        if (metaParts.length > 0) {
          outputLines.push(`Matches: ${metaParts.join(", ")}`)
        }

        outputLines.push("```")

        // Show shaked content (already collapsed)
        const lines = shaked.shakedContent.split("\n")
        for (const line of lines.slice(0, 100)) {
          const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
          outputLines.push(truncated)
        }
        if (lines.length > 100) {
          outputLines.push(`// ... (${lines.length - 100} more lines) ...`)
        }

        outputLines.push("```\n")
      }

      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          files: shakedResults.length,
          indexed: true,
          shaked: true,
          freshness,
        },
        freshness,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Fallback: original formatting without tree-shaking
    const outputLines = [`Found ${finalResults.length} results\n`]

    for (const result of finalResults) {
      const meta = result.metadata

      // File location with symbol hints
      const hints = []
      if (meta.symbolName) hints.push(meta.symbolName)
      if (meta.symbolType) hints.push(meta.symbolType)

      const location =
        hints.length > 0
          ? `${result.file}:${result.startLine} (${hints.join(", ")})`
          : `${result.file}:${result.startLine}-${result.endLine}`

      outputLines.push(`## ${location}`)

      // Show selective metadata: score + important attributes
      const metaParts = []

      // Always show relevance score
      metaParts.push(`Relevance: ${(result.semanticScore * 100).toFixed(1)}%`)
      if (result.confidence) {
        metaParts.push(`Confidence: ${result.confidence}`)
      }
      if (result.rerankScore !== undefined) {
        metaParts.push(`Rerank: ${result.rerankScore.toFixed(3)}`)
      }

      // Show complexity if it's significant or was filtered
      if (typeof meta.complexity === "number" && meta.complexity > 0) {
        metaParts.push(`Complexity: ${meta.complexity}`)
      }

      // Show if it's a method (has parent scope)
      if (meta.parentScope && typeof meta.parentScope === "string") {
        metaParts.push(`in ${meta.parentScope}`)
      }
      if (meta.semanticKind && typeof meta.semanticKind === "string") {
        metaParts.push(`Kind: ${meta.semanticKind}`)
      }
      if ((params as any).explainFilters && result.whyMatched?.length) {
        metaParts.push(`Why: ${result.whyMatched.join("; ")}`)
      }

      if (metaParts.length > 0) {
        outputLines.push(metaParts.join(" | "))
      }

      outputLines.push("```")

      // Show actual code content
      const lines = result.content.split("\n")
      for (const line of lines.slice(0, 30)) {
        const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
        outputLines.push(truncated)
      }
      if (lines.length > 30) {
        outputLines.push(`... (${lines.length - 30} more lines)`)
      }

      outputLines.push("```\n")
    }

      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          indexed: true,
          freshness,
        },
        freshness,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Use withConfig to match index embeddings and ensure proper cleanup
    return Embeddings.withConfig(indexConfig as any, () =>
      Instance.provide({
        directory: resolved.root,
        fn: run,
      }),
    )
  },
})
