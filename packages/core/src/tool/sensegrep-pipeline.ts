import path from "path"
import { spawn } from "node:child_process"
import { once } from "node:events"
import picomatch from "picomatch"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { GitScope } from "../project/git.js"
import { Embeddings } from "../semantic/embeddings.js"
import { Indexer } from "../semantic/indexer.js"
import { Ripgrep } from "../file/ripgrep.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import { expandSemanticKindFilter } from "../semantic/language/index.js"

export type ResultMetadata = Record<string, string | number | boolean | string[] | undefined>

export type WorkingResult = {
  id?: string
  file: string
  content: string
  startLine: number
  endLine: number
  semanticScore: number
  rawDistance?: number
  distanceMetric?: VectorStore.DistanceMetric
  metadata: ResultMetadata
  rerankScore?: number
  vector?: number[]
  confidence?: "high" | "medium" | "low"
  isWeakMatch?: boolean
  whyMatched?: string[]
  filterMatches?: Record<string, unknown>
}

export type StructuredSearchResult = {
  file: string
  startLine: number
  endLine: number
  score: number
  rawDistance?: number
  distanceMetric?: VectorStore.DistanceMetric
  symbolName?: string
  symbolType?: string
  type?: string
  language?: string
  parentScope?: string
  imports?: string[]
  semanticKind?: string
  framework?: string
  confidence: "high" | "medium" | "low"
  isWeakMatch: boolean
  whyMatched: string[]
  filterMatches?: Record<string, unknown>
  content: string
  metadata: ResultMetadata
}

export type CommonSensegrepParams = {
  query: string
  pattern?: string
  limit?: number
  include?: string
  exclude?: string
  minScore?: number
  symbol?: string
  name?: string
  symbolType?: "function" | "class" | "method" | "type" | "variable" | "enum" | "module"
  variant?: string
  decorator?: string
  isExported?: boolean
  isAsync?: boolean
  isStatic?: boolean
  isAbstract?: boolean
  minComplexity?: number
  maxComplexity?: number
  hasDocumentation?: boolean
  language?: string
  parentScope?: string
  imports?: string
  semanticKind?: string
  explainFilters?: boolean
  strictParent?: boolean
  strictImports?: boolean
  shake?: boolean
  exact?: boolean
  hybrid?: boolean
  rerank?: boolean
  maxTokens?: number
  gitChanged?: boolean
  gitBase?: string
  latencyBudgetMs?: number
}

type IndexMeta = NonNullable<Awaited<ReturnType<typeof VectorStore.readIndexMeta>>>

export type FreshnessSummary = {
  indexed: boolean
  isStale: boolean
  changed: number
  missing: number
  removed: number
  chunkMismatch: boolean
  expectedChunks?: number
  actualChunks?: number
  updatedAt?: number
}

export type SearchResources = {
  meta: IndexMeta
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>
  projectDirectory: string
  requestedDirectory: string
  subdirPrefix?: string
  freshness: FreshnessSummary
}

type ToolLikeResult = {
  title: string
  metadata: Record<string, unknown>
  output: string
  [key: string]: unknown
}

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".rb", ".php", ".swift", ".kt", ".scala", ".vue", ".svelte",
])

type FileFilterContext = {
  includeMatcher?: ReturnType<typeof createGlobMatcher>
  excludeMatcher?: ReturnType<typeof createGlobMatcher>
  candidateFiles?: string[]
}

type CollectWorkingResultsOptions = {
  rawLimit: number
  diversify?: boolean
  maxPerFile?: number
  maxPerSymbol?: number
  signal?: AbortSignal
}

const MAX_LINE_LENGTH = 2000
const GENERIC_PATH_SEGMENTS = new Set([
  "src",
  "lib",
  "app",
  "packages",
  "package",
  "backend",
  "frontend",
])
const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "this",
  "that",
  "auth",
  "query",
  "data",
  "logic",
  "code",
  "flow",
  "impl",
  "service",
  "services",
  "store",
  "stores",
  "class",
  "function",
  "method",
  "module",
  "file",
  "type",
  "types",
  "use",
  "define",
  "get",
  "set",
  "has",
  "is",
  "handle",
])

export function summarizeFreshness(
  verify: Awaited<ReturnType<typeof Indexer.verifyIndex>>,
): FreshnessSummary {
  const chunkMismatch = (verify as any).chunkMismatch === true
  return {
    indexed: verify.indexed,
    isStale: !verify.indexed || verify.changed > 0 || verify.missing > 0 || verify.removed > 0 || chunkMismatch,
    changed: verify.changed,
    missing: verify.missing,
    removed: verify.removed,
    chunkMismatch,
    expectedChunks: (verify as any).expectedChunks,
    actualChunks: (verify as any).actualChunks,
    updatedAt: (verify as any).updatedAt,
  }
}

export async function getFreshnessSummary(): Promise<FreshnessSummary> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    const verify = await Promise.race([
      Indexer.verifyIndex({ signal: controller.signal, contentHash: false }),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort(new Error("Freshness verification timed out"))
          resolve(undefined)
        }, 2_000)
        timeout.unref?.()
      }),
    ])
    if (!verify) {
      return {
        indexed: true,
        isStale: false,
        changed: 0,
        missing: 0,
        removed: 0,
        chunkMismatch: false,
      }
    }
    return summarizeFreshness(verify)
  } catch {
    return {
      indexed: true,
      isStale: false,
      changed: 0,
      missing: 0,
      removed: 0,
      chunkMismatch: false,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    if (!controller.signal.aborted) controller.abort()
  }
}

export function formatFreshnessWarning(freshness: FreshnessSummary): string | undefined {
  if (!freshness.isStale) return undefined
  const parts = [
    `changed=${freshness.changed}`,
    `missing=${freshness.missing}`,
    `removed=${freshness.removed}`,
    `chunkMismatch=${freshness.chunkMismatch}`,
  ]
  return `Warning: index may be stale (${parts.join(", ")}). Run \`sensegrep index --no-watch\` or \`sensegrep index --full --no-watch\` for structural metadata changes.`
}

export function prependFreshnessWarning(output: string, freshness: FreshnessSummary): string {
  const warning = formatFreshnessWarning(freshness)
  return warning ? `${warning}\n\n${output}` : output
}

export async function withIndexedSearchResources<T extends ToolLikeResult>(
  query: string,
  fn: (resources: SearchResources) => Promise<T>,
): Promise<T> {
  const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
  if (!resolved?.meta.embeddings) {
    return {
      title: query,
      metadata: { matches: 0, indexed: false },
      output:
        "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
    } as unknown as T
  }

  const meta = resolved.meta
  const indexConfig = {
    provider: meta.embeddings.provider,
    embedModel: meta.embeddings.model,
    embedDim: meta.embeddings.dimension,
  }

  return Embeddings.withConfig(indexConfig as any, async () => {
    return Instance.provide({
      directory: resolved.root,
      fn: async () => {
        const freshness = await getFreshnessSummary()
        const collection = await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)
        return fn({
          meta,
          collection,
          projectDirectory: resolved.root,
          requestedDirectory: resolved.requestedPath,
          subdirPrefix: resolved.subdirPrefix,
          freshness,
        })
      },
    })
  })
}

export function normalizeFilePath(file: string): string {
  return file.replace(/\\/g, "/")
}

export function canonicalizeProjectFilePath(file: string): string {
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

export function expandFilePathVariants(file: string): string[] {
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

export function createGlobMatcher(pattern: string) {
  const normalizedPattern = canonicalizeProjectFilePath(pattern)
  const hasPathSeparator = normalizedPattern.includes("/")
  return picomatch(normalizedPattern, {
    dot: true,
    basename: !hasPathSeparator,
  })
}

export function getScopedFilePath(file: string, subdirPrefix?: string): string | undefined {
  const normalizedFile = canonicalizeProjectFilePath(file)
  if (!subdirPrefix) return normalizedFile

  const normalizedPrefix = normalizeFilePath(subdirPrefix).replace(/^\.\//, "").replace(/\/$/, "")
  if (normalizedFile === normalizedPrefix) return ""
  const prefixWithSlash = `${normalizedPrefix}/`
  if (!normalizedFile.toLowerCase().startsWith(prefixWithSlash.toLowerCase())) return undefined
  return normalizedFile.slice(prefixWithSlash.length)
}

export function matchesScopedGlob(
  file: string,
  matcher: ReturnType<typeof createGlobMatcher> | undefined,
  subdirPrefix?: string,
): boolean {
  if (!matcher) return true
  const projectPath = canonicalizeProjectFilePath(file)
  const scopedPath = getScopedFilePath(file, subdirPrefix)
  return matcher(projectPath) || (scopedPath !== undefined && matcher(scopedPath))
}

// Batch ripgrep file arguments to avoid command line length limits (notably on Windows).
const RIPGREP_MAX_ARG_CHARS = process.platform === "win32" ? 7000 : 30000
const RIPGREP_MAX_FILES_PER_BATCH = 256

export async function runRipgrepOnFiles(
  pattern: string,
  files: string[],
  options?: {
    caseSensitive?: boolean
    fixedStrings?: boolean
    signal?: AbortSignal
    maxMatches?: number
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
    const args: string[] = ["-n", "--no-heading"]

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
      signal: options?.signal,
    })

    const closePromise = once(proc, "close") as Promise<[number | null]>

    let output = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    const [code] = await closePromise
    if (code && code !== 1) {
      throw new Error(`ripgrep failed with code ${code}: ${stderr}`)
    }

    // Parse output: "file:line:text"
    for (const line of output.trim().split("\n")) {
      if (!line) continue
      const match = line.match(/^(.*):(\d+):(.*)$/)
      if (!match) continue

      const [, matchedPath, lineNum, text] = match
      matches.push({
        file: canonicalizeProjectFilePath(matchedPath),
        line: parseInt(lineNum, 10),
        text: text.trim(),
      })
      if (options?.maxMatches && matches.length >= options.maxMatches) return matches
    }
  }

  return matches
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function lexicalRelevance(queryTokens: string[], result: Pick<WorkingResult, "content" | "file" | "metadata">): number {
  if (queryTokens.length === 0) return 0
  const content = result.content.toLowerCase()
  const symbol = String(result.metadata.symbolName ?? "").toLowerCase()
  const file = result.file.toLowerCase()
  let covered = 0
  let weightedFrequency = 0

  for (const token of queryTokens) {
    const occurrences = content.match(new RegExp(`\\b${escapeRegex(token)}\\b`, "gi"))?.length ?? 0
    const symbolHit = symbol.includes(token) ? 1 : 0
    const pathHit = file.includes(token) ? 1 : 0
    if (occurrences > 0 || symbolHit || pathHit) covered++
    weightedFrequency += Math.min(occurrences, 4) + symbolHit * 3 + pathHit
  }

  const coverage = covered / queryTokens.length
  const density = Math.min(1, weightedFrequency / Math.max(3, queryTokens.length * 3))
  return Math.min(1, coverage * 0.7 + density * 0.3)
}

export async function collectLexicalQueryResults(
  query: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<WorkingResult[]> {
  const tokens = getQueryTokens(query).filter((token) => token.length >= 2).slice(0, 12)
  if (tokens.length === 0 || files.length === 0) return []
  const matches = await runRipgrepOnFiles(tokens.map(escapeRegex).join("|"), files, {
    signal: options.signal,
    maxMatches: Math.max(100, (options.limit ?? 50) * 20),
  })
  const byFile = new Map<string, number[]>()
  for (const match of matches) {
    const file = canonicalizeProjectFilePath(match.file)
    const lines = byFile.get(file) ?? []
    lines.push(match.line)
    byFile.set(file, lines)
  }

  const found = new Map<string, WorkingResult>()
  for (const [file, lines] of byFile) {
    const documents = await VectorStore.listDocuments(collection, {
      filters: buildFiltersWithFileVariants(filters, file),
    })
    for (const line of lines) {
      const selected = pickBestLiteralDocument(documents, line)
      if (!selected) continue
      const key = `${selected.metadata.file}:${selected.metadata.startLine}:${selected.metadata.endLine}`
      if (found.has(key)) continue
      const candidate: WorkingResult = {
        id: selected.id,
        file: String(selected.metadata.file),
        content: selected.content,
        startLine: Number(selected.metadata.startLine),
        endLine: Number(selected.metadata.endLine),
        semanticScore: 0,
        metadata: selected.metadata,
      }
      candidate.semanticScore = lexicalRelevance(tokens, candidate)
      const matchedTokens = tokens.filter((token) => candidate.content.toLowerCase().includes(token))
      candidate.whyMatched = [`lexical retrieval: ${matchedTokens.join(", ")}`]
      found.set(key, candidate)
    }
  }
  return [...found.values()].sort((a, b) => b.semanticScore - a.semanticScore).slice(0, options.limit ?? 50)
}

export function fuseHybridResults(semantic: WorkingResult[], lexical: WorkingResult[]): WorkingResult[] {
  const keyOf = (result: WorkingResult) => `${result.file}:${result.startLine}:${result.endLine}`
  const semanticRank = new Map(semantic.map((result, index) => [keyOf(result), index + 1]))
  const lexicalRank = new Map(lexical.map((result, index) => [keyOf(result), index + 1]))
  const merged = new Map<string, WorkingResult>()
  for (const result of [...semantic, ...lexical]) {
    const key = keyOf(result)
    const existing = merged.get(key)
    merged.set(key, existing ? {
      ...existing,
      id: existing.id ?? result.id,
      semanticScore: Math.max(existing.semanticScore, result.semanticScore),
      whyMatched: [...new Set([...(existing.whyMatched ?? []), ...(result.whyMatched ?? [])])],
    } : result)
  }

  const k = 60
  const maxRrf = 2 / (k + 1)
  return [...merged.entries()].map(([key, result]) => {
    const semanticPosition = semanticRank.get(key)
    const lexicalPosition = lexicalRank.get(key)
    const rrf = (
      (semanticPosition ? 1 / (k + semanticPosition) : 0) +
      (lexicalPosition ? 1 / (k + lexicalPosition) : 0)
    ) / maxRrf
    const score = result.semanticScore > 1
      ? result.semanticScore
      : Math.min(1, result.semanticScore * 0.65 + rrf * 0.35)
    return { ...result, semanticScore: score }
  }).sort((a, b) => b.semanticScore - a.semanticScore)
}

export function rerankWorkingResults(query: string, results: WorkingResult[]): WorkingResult[] {
  const tokens = getQueryTokens(query)
  return results.map((result) => {
    if (result.semanticScore > 1) return { ...result, rerankScore: result.semanticScore }
    const lexical = lexicalRelevance(tokens, result)
    const symbol = String(result.metadata.symbolName ?? "").toLowerCase()
    const exactSymbol = tokens.some((token) => symbol === token) ? 1 : 0
    const exported = result.metadata.isExported === true ? 1 : 0
    const structural = exactSymbol * 0.7 + exported * 0.3
    const rerankScore = Math.min(1, result.semanticScore * 0.72 + lexical * 0.2 + structural * 0.08)
    return {
      ...result,
      rerankScore,
      whyMatched: [...new Set([...(result.whyMatched ?? []), `reranked: lexical=${lexical.toFixed(2)} structural=${structural.toFixed(2)}`])],
    }
  }).sort((a, b) => (b.rerankScore ?? b.semanticScore) - (a.rerankScore ?? a.semanticScore))
}

export function estimateResultTokens(result: Pick<WorkingResult, "content" | "file" | "metadata">): number {
  const metadataOverhead = result.file.length + String(result.metadata.symbolName ?? "").length + 80
  return Math.max(1, Math.ceil((result.content.length + metadataOverhead) / 4))
}

export function selectWithinTokenBudget(results: WorkingResult[], maxTokens?: number): { results: WorkingResult[]; estimatedTokens: number } {
  if (!maxTokens) {
    return { results, estimatedTokens: results.reduce((sum, result) => sum + estimateResultTokens(result), 0) }
  }
  const selected: WorkingResult[] = []
  let estimatedTokens = 0
  for (const result of results) {
    const tokens = estimateResultTokens(result)
    if (selected.length > 0 && estimatedTokens + tokens > maxTokens) continue
    selected.push(result)
    estimatedTokens += tokens
    if (estimatedTokens >= maxTokens) break
  }
  return { results: selected, estimatedTokens }
}

export function buildSearchFilters(params: CommonSensegrepParams): VectorStore.SearchFilters {
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
  if (params.semanticKind) {
    const semanticKinds = expandSemanticKindFilter(params.semanticKind)
    if (semanticKinds.length === 1) {
      filters.all!.push({ key: "semanticKind", operator: "equals", value: semanticKinds[0] })
    } else if (semanticKinds.length > 1) {
      filters.any = [
        ...(filters.any ?? []),
        ...semanticKinds.map((value) => ({ key: "semanticKind", operator: "equals" as const, value })),
      ]
    } else {
      filters.all!.push({ key: "semanticKind", operator: "equals", value: params.semanticKind })
    }
  }
  if (params.imports) {
    const importValues = params.strictImports
      ? parseRequestedImportModules(params.imports)
      : expandImportFilterValues(params.imports)
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

  return filters
}

export function expandImportFilterValues(imports: string): string[] {
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

export function normalizeImportModule(value: string): string {
  return value.trim().replace(/^['"`]|['"`]$/g, "").replace(/\\/g, "/").replace(/\/$/, "")
}

export function parseRequestedImportModules(imports: string): string[] {
  return imports.split(",").map(normalizeImportModule).filter(Boolean)
}

export function matchesStrictStructuralFilters(
  result: Pick<WorkingResult, "metadata">,
  params: Pick<CommonSensegrepParams, "imports" | "strictImports" | "parentScope" | "strictParent">,
): boolean {
  if (params.strictImports && params.imports) {
    const available = new Set(splitListField(result.metadata.imports).map(normalizeImportModule))
    if (!parseRequestedImportModules(params.imports).some((requested) => available.has(requested))) return false
  }
  if (params.strictParent && params.parentScope) {
    const parent = typeof result.metadata.parentScope === "string" ? result.metadata.parentScope : ""
    if (parent !== params.parentScope) return false
  }
  return true
}

function resolveFileFiltering(
  meta: IndexMeta,
  params: CommonSensegrepParams,
  filters: VectorStore.SearchFilters,
  subdirPrefix?: string,
  gitFiles?: Set<string>,
): FileFilterContext | ToolLikeResult {
  let includeMatcher: ReturnType<typeof createGlobMatcher> | undefined
  let excludeMatcher: ReturnType<typeof createGlobMatcher> | undefined
  if (params.include) includeMatcher = createGlobMatcher(params.include)
  if (params.exclude) excludeMatcher = createGlobMatcher(params.exclude)

  if (!includeMatcher && !excludeMatcher && !subdirPrefix && !gitFiles) {
    return { includeMatcher, excludeMatcher }
  }

  const indexedFiles = Object.keys(meta.files ?? {})
  const candidateFiles = indexedFiles.filter((file) => {
    if (gitFiles && !gitFiles.has(canonicalizeProjectFilePath(file))) return false
    if (getScopedFilePath(file, subdirPrefix) === undefined) return false
    if (!matchesScopedGlob(file, includeMatcher, subdirPrefix)) return false
    if (excludeMatcher && matchesScopedGlob(file, excludeMatcher, subdirPrefix)) return false
    return true
  })

  if (candidateFiles.length === 0) {
    const filterLabel = [
      params.include ? `include="${params.include}"` : null,
      params.exclude ? `exclude="${params.exclude}"` : null,
      subdirPrefix ? `scope="${subdirPrefix}"` : null,
      gitFiles ? "git-changed" : null,
    ]
      .filter(Boolean)
      .join(", ")

    const warning = `No indexed files matched the file filters${filterLabel ? ` (${filterLabel})` : ""}.`
    return {
      title: params.query,
      metadata: { matches: 0, indexed: true, warnings: [warning] },
      warnings: [warning],
      results: [],
      output: warning,
    }
  }

  filters.all!.push({
    key: "file",
    operator: "in",
    value: [...new Set(candidateFiles.flatMap((file) => expandFilePathVariants(file)))],
  })

  return { includeMatcher, excludeMatcher, candidateFiles }
}

export function queryLooksLikeIdentifier(query: string): boolean {
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

export function queryLooksLikeSimpleIdentifier(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.length >= 2 && trimmed.length <= 120 && !/\s/.test(trimmed) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)
}

export async function collectExactSymbolResults(
  symbolName: string,
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
): Promise<WorkingResult[]> {
  const rows = await VectorStore.listDocuments(collection, {
    filters: { ...filters, all: [...(filters.all ?? []), { key: "symbolName", operator: "equals", value: symbolName }] },
  })
  return rows.map((row) => ({
    id: row.id,
    file: String(row.metadata.file),
    content: row.content,
    startLine: Number(row.metadata.startLine),
    endLine: Number(row.metadata.endLine),
    semanticScore: 1.08,
    metadata: row.metadata,
    whyMatched: [`exact symbol lookup: ${symbolName}`],
  }))
}

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function buildFiltersWithFileVariants(filters: VectorStore.SearchFilters, filePath: string): VectorStore.SearchFilters {
  return {
    ...filters,
    all: [...(filters.all ?? []), { key: "file", operator: "in", value: expandFilePathVariants(filePath) }],
  }
}

export function pickBestLiteralDocument(
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

export async function collectRipgrepFallbackResults(
  pattern: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
  options?: {
    caseSensitive?: boolean
    fixedStrings?: boolean
    semanticScore?: number
  },
): Promise<WorkingResult[]> {
  const rgMatches = await runRipgrepOnFiles(pattern, files, {
    caseSensitive: options?.caseSensitive,
    fixedStrings: options?.fixedStrings,
  })
  if (rgMatches.length === 0) return []

  const byFile = new Map<string, { line: number }[]>()
  for (const match of rgMatches) {
    const canonicalFile = canonicalizeProjectFilePath(match.file)
    const list = byFile.get(canonicalFile) ?? []
    list.push({ line: match.line })
    byFile.set(canonicalFile, list)
  }

  const results = new Map<string, WorkingResult>()
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
        isWeakMatch: !isCodeFile(selected.metadata.file as string),
        whyMatched: [
          options?.fixedStrings ? `literal matched: ${pattern}` : `pattern matched: ${pattern}`,
        ],
      })
    }
  }

  const resultList = [...results.values()]
  return [
    ...resultList.filter((result) => isCodeFile(result.file)),
    ...resultList.filter((result) => !isCodeFile(result.file)),
  ]
}

export async function collectLiteralFallbackResults(
  query: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
): Promise<WorkingResult[]> {
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

export function dedupeOverlapping<T extends { file: string; startLine: number; endLine: number; semanticScore: number; metadata: Record<string, unknown> }>(
  results: T[],
  options?: { overlapThreshold?: number; scoreSlack?: number },
): T[] {
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

export function diversifyResults<T extends { file: string; metadata: Record<string, unknown> }>(
  results: T[],
  limits: { maxPerFile: number; maxPerSymbol: number },
): T[] {
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

export async function collectWorkingResults(
  resources: SearchResources,
  params: CommonSensegrepParams,
  options: CollectWorkingResultsOptions,
): Promise<{ results: WorkingResult[]; filters: VectorStore.SearchFilters; candidateFiles?: string[]; lexicalOnly: boolean; warnings: string[]; metrics: Record<string, number> } | ToolLikeResult> {
  const metrics: Record<string, number> = { semanticSearchMs: 0 }
  const warnings: string[] = []
  const filters = buildSearchFilters(params)
  const gitFiles = params.gitChanged
    ? new Set(await GitScope.changedFiles(Instance.directory, { base: params.gitBase, signal: options.signal }))
    : undefined
  const fileFiltering = resolveFileFiltering(resources.meta, params, filters, resources.subdirPrefix, gitFiles)
  if ("output" in fileFiltering) return fileFiltering

  const searchOptions: { limit: number; filters?: VectorStore.SearchFilters } = {
    limit: options.rawLimit,
  }
  if ((filters.all && filters.all.length > 0) || (filters.any && filters.any.length > 0)) {
    searchOptions.filters = filters
  }

  const shouldRunLiteralFallback = !params.pattern && queryLooksLikeIdentifier(params.query)
  let literalFallbackResults: WorkingResult[] = []
  const lexicalCandidateFiles =
    params.hybrid !== false || shouldRunLiteralFallback || params.pattern
      ? fileFiltering.candidateFiles ??
        Object.keys(resources.meta.files ?? {}).filter((file) => {
          if (getScopedFilePath(file, resources.subdirPrefix) === undefined) return false
          if (!matchesScopedGlob(file, fileFiltering.includeMatcher, resources.subdirPrefix)) return false
          if (fileFiltering.excludeMatcher && matchesScopedGlob(file, fileFiltering.excludeMatcher, resources.subdirPrefix)) return false
          return true
        })
      : []

  if (shouldRunLiteralFallback) {
    const startedAt = Date.now()
    literalFallbackResults = await collectLiteralFallbackResults(
      params.query,
      lexicalCandidateFiles,
      resources.collection,
      filters,
    )
    metrics.literalFallbackMs = Date.now() - startedAt
  }

  const simpleIdentifierQuery = queryLooksLikeSimpleIdentifier(params.query)
  const exactSymbolQuery = params.symbol ?? params.name ?? (params.exact || simpleIdentifierQuery ? params.query.trim() : undefined)
  const exactStartedAt = Date.now()
  const exactSymbolResults = exactSymbolQuery
    ? await collectExactSymbolResults(exactSymbolQuery, resources.collection, filters)
    : []
  metrics.exactSymbolLookupMs = Date.now() - exactStartedAt

  const hybridLexicalStartedAt = Date.now()
  const hybridLexicalResults = params.hybrid !== false && !params.pattern && params.exact !== true && !shouldRunLiteralFallback && !exactSymbolQuery
    ? await collectLexicalQueryResults(
        params.query,
        lexicalCandidateFiles,
        resources.collection,
        filters,
        { signal: options.signal, limit: options.rawLimit },
      ).catch((error) => {
        if (options.signal?.aborted) throw error
        warnings.push(`Lexical retrieval unavailable; using semantic results only: ${error instanceof Error ? error.message : String(error)}`)
        return []
      })
    : []
  metrics.lexicalSearchMs = Date.now() - hybridLexicalStartedAt

  const lexicalOnly =
    !params.pattern &&
    (exactSymbolResults.length > 0 || literalFallbackResults.length > 0) &&
    (params.exact === true || Boolean(params.symbol ?? params.name) || (simpleIdentifierQuery && exactSymbolResults.length > 0))

  let semanticResults: Awaited<ReturnType<typeof VectorStore.search>> = []
  if (!lexicalOnly) {
    const semanticStartedAt = Date.now()
    semanticResults = await VectorStore.search(resources.collection, params.query, {
      ...searchOptions,
      signal: options.signal,
      retryDeadlineMs: params.latencyBudgetMs,
    }).catch((error) => {
      if (options.signal?.aborted) throw error
      warnings.push(`Semantic provider unavailable within the latency budget; returning exact/lexical results only: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    metrics.semanticSearchMs = Date.now() - semanticStartedAt

    if (fileFiltering.includeMatcher) {
      semanticResults = semanticResults.filter((result) =>
        matchesScopedGlob(result.metadata.file as string, fileFiltering.includeMatcher, resources.subdirPrefix),
      )
    }
    if (fileFiltering.excludeMatcher) {
      semanticResults = semanticResults.filter((result) =>
        !matchesScopedGlob(result.metadata.file as string, fileFiltering.excludeMatcher, resources.subdirPrefix),
      )
    }
  }

  let filteredResults = semanticResults
  if (params.pattern && semanticResults.length > 0) {
    const uniqueFiles = [...new Set(semanticResults.map((result) => result.metadata.file as string))]
    const rgMatches = await runRipgrepOnFiles(params.pattern, uniqueFiles)

    filteredResults = semanticResults.filter((result) => {
      const file = canonicalizeProjectFilePath(result.metadata.file as string)
      const startLine = result.metadata.startLine as number
      const endLine = result.metadata.endLine as number
      return rgMatches.some((match) => match.file === file && match.line >= startLine && match.line <= endLine)
    })
  }

  let patternFallbackResults: WorkingResult[] = []
  if (params.pattern) {
    patternFallbackResults = await collectRipgrepFallbackResults(
      params.pattern,
      lexicalCandidateFiles,
      resources.collection,
      filters,
      { semanticScore: 1.04 },
    )
  }

  let workingResults: WorkingResult[] = filteredResults.map((result) => ({
    id: result.id,
    file: result.metadata.file as string,
    content: result.content,
    startLine: result.metadata.startLine as number,
    endLine: result.metadata.endLine as number,
    semanticScore: VectorStore.distanceToSimilarity(result.distance, VectorStore.getDistanceMetric(resources.meta)),
    rawDistance: result.distance,
    distanceMetric: VectorStore.getDistanceMetric(resources.meta),
    metadata: result.metadata,
    whyMatched: ["semantic similarity"],
  }))

  const fallbackResults = [...exactSymbolResults, ...literalFallbackResults, ...patternFallbackResults]
  workingResults = fuseHybridResults(workingResults, [...hybridLexicalResults, ...fallbackResults])

  workingResults = annotateWorkingResults(workingResults, params)
  workingResults = workingResults.filter((result) => matchesStrictStructuralFilters(result, params))
  workingResults = params.rerank ? rerankWorkingResults(params.query, workingResults) : workingResults
  workingResults.sort((a, b) => (b.rerankScore ?? b.semanticScore) - (a.rerankScore ?? a.semanticScore))

  const minScore = typeof params.minScore === "number" ? params.minScore : undefined
  if (minScore !== undefined) {
    workingResults = workingResults.filter((result) => (result.rerankScore ?? result.semanticScore) >= minScore)
  }

  let processedResults = dedupeOverlapping(workingResults)
  if (options.diversify !== false) {
    processedResults = diversifyResults(processedResults, {
      maxPerFile: options.maxPerFile ?? 2,
      maxPerSymbol: options.maxPerSymbol ?? 2,
    })
  }

  return {
    results: processedResults,
    filters,
    candidateFiles: fileFiltering.candidateFiles,
    lexicalOnly,
    warnings,
    metrics,
  }
}

export async function hydrateResultsWithVectors(
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  results: WorkingResult[],
): Promise<WorkingResult[]> {
  const ids = [...new Set(results.map((result) => result.id).filter((value): value is string => Boolean(value)))]
  if (ids.length === 0) return results

  const docMap = new Map<string, Awaited<ReturnType<typeof VectorStore.listDocuments>>[number]>()
  const chunkSize = 100
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize)
    const docs = await VectorStore.listDocuments(collection, {
      filters: {
        all: [{ key: "id", operator: "in", value: chunk }],
      },
      columns: [
        "id",
        "vector",
        "imports",
        "parentScope",
        "semanticKind",
        "framework",
        "language",
        "symbolName",
        "symbolType",
        "variant",
        "file",
        "startLine",
        "endLine",
      ],
    })

    for (const doc of docs) {
      docMap.set(doc.id, doc)
    }
  }

  return results.map((result) => {
    if (!result.id) return result
    const doc = docMap.get(result.id)
    if (!doc) return result
    return {
      ...result,
      vector: Array.isArray(doc.vector) ? (doc.vector as number[]) : result.vector,
      metadata: {
        ...result.metadata,
        ...doc.metadata,
      },
    }
  })
}

export function splitListField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeImportToken(value: string): string {
  const trimmed = value.replace(/^['"`]|['"`]$/g, "")
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const last = parts[parts.length - 1] ?? trimmed
  return last.toLowerCase()
}

export function getImportHints(metadata: ResultMetadata): string[] {
  return splitListField(metadata.imports)
    .map(normalizeImportToken)
    .filter(Boolean)
}

function splitIdentifier(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function getQueryTokens(query: string): string[] {
  return splitIdentifier(query).filter((token) => !TOKEN_STOPWORDS.has(token))
}

export function getSymbolTokens(metadata: ResultMetadata): string[] {
  const symbolName = typeof metadata.symbolName === "string" ? metadata.symbolName : ""
  return splitIdentifier(symbolName).filter((token) => !TOKEN_STOPWORDS.has(token))
}

export function getDominantSymbolPhrases(
  results: WorkingResult[],
  query: string,
  maxItems = 3,
  excludeQueryTokens = true,
): string[] {
  const queryTokens = new Set(getQueryTokens(query))
  const counts = new Map<string, number>()

  for (const result of results) {
    const tokens = getSymbolTokens(result.metadata)
      .filter((token) => !excludeQueryTokens || !queryTokens.has(token))
      .slice(0, 4)
    if (tokens.length < 2) continue
    const phrase = tokens.join(" ")
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    .slice(0, maxItems)
    .map(([phrase]) => phrase)
}

function scoreToConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 0.55) return "high"
  if (score >= 0.25) return "medium"
  return "low"
}

function raiseConfidence(
  current: "high" | "medium" | "low",
  floor: "high" | "medium" | "low",
): "high" | "medium" | "low" {
  const rank = { low: 0, medium: 1, high: 2 } as const
  return rank[floor] > rank[current] ? floor : current
}

function calibratedConfidence(
  score: number,
  signals: {
    exactSymbolMatch: boolean
    symbolFilterMatch: boolean
    symbolTokenMatches: number
    patternMatch: boolean
    semanticKindMatch: boolean
    structuralMatches: number
    strictStructuralMatches: number
  },
): "high" | "medium" | "low" {
  if (signals.exactSymbolMatch) return "high"

  let confidence = scoreToConfidence(score)

  if (
    signals.strictStructuralMatches >= 2 ||
    (signals.patternMatch && signals.structuralMatches >= 1) ||
    (signals.semanticKindMatch && (signals.patternMatch || signals.symbolFilterMatch))
  ) {
    confidence = raiseConfidence(confidence, "high")
  } else if (
    signals.symbolFilterMatch ||
    signals.patternMatch ||
    signals.semanticKindMatch ||
    signals.strictStructuralMatches > 0
  ) {
    confidence = raiseConfidence(confidence, "medium")
  } else if (signals.symbolTokenMatches > 0 && score > -0.1) {
    confidence = raiseConfidence(confidence, "medium")
  }

  return confidence
}

function safeRegexMatch(pattern: string, content: string): boolean {
  try {
    return new RegExp(pattern, "i").test(content)
  } catch {
    return content.toLowerCase().includes(pattern.toLowerCase())
  }
}

export function annotateWorkingResults(results: WorkingResult[], params: CommonSensegrepParams): WorkingResult[] {
  const queryTokens = getQueryTokens(params.query)
  const importFilters = params.imports ? expandImportFilterValues(params.imports) : []
  const symbolQuery = params.symbol ?? params.name

  return results.map((result) => {
    const metadata = result.metadata
    const score = result.rerankScore ?? result.semanticScore
    const whyMatched = new Set<string>(
      result.whyMatched && result.whyMatched.length > 0 ? result.whyMatched : ["semantic similarity"],
    )
    const filterMatches: Record<string, unknown> = {}
    const signals = {
      exactSymbolMatch: false,
      symbolFilterMatch: false,
      symbolTokenMatches: 0,
      patternMatch: false,
      semanticKindMatch: false,
      structuralMatches: 0,
      strictStructuralMatches: 0,
    }

    const symbolName = typeof metadata.symbolName === "string" ? metadata.symbolName : ""
    const symbolTokens = getSymbolTokens(metadata)
    for (const token of queryTokens) {
      if (symbolTokens.includes(token)) {
        whyMatched.add(`symbol token matched query: ${token}`)
        signals.symbolTokenMatches += 1
      }
    }

    const pathSegments = getMeaningfulPathSegments(result.file).map((segment) => segment.toLowerCase())
    for (const token of queryTokens) {
      if (pathSegments.some((segment) => segment.includes(token))) {
        whyMatched.add(`path matched query token: ${token}`)
      }
    }

    if (params.pattern && safeRegexMatch(params.pattern, result.content)) {
      whyMatched.add(`pattern matched: ${params.pattern}`)
      filterMatches.pattern = { matched: true, mode: "ripgrep", value: params.pattern }
      signals.patternMatch = true
      signals.structuralMatches += 1
    }

    if (params.parentScope) {
      const parentScope = typeof metadata.parentScope === "string" ? metadata.parentScope : ""
      const matched = parentScope.toLowerCase().includes(params.parentScope.toLowerCase())
      if (matched) whyMatched.add(`parent matched: ${parentScope}`)
      if (matched) {
        signals.structuralMatches += 1
        if (params.strictParent) signals.strictStructuralMatches += 1
      }
      filterMatches.parent = {
        matched,
        mode: params.strictParent ? "metadata-strict" : "metadata",
        value: parentScope || params.parentScope,
      }
    }

    if (params.imports) {
      const imports = splitListField(metadata.imports)
      const matched = params.strictImports
        ? parseRequestedImportModules(params.imports).filter((value) => imports.map(normalizeImportModule).includes(value))
        : importFilters.filter((value) => imports.some((item) => item.includes(value)))
      if (matched.length > 0) whyMatched.add(`import matched: ${matched.join(", ")}`)
      if (matched.length > 0) {
        signals.structuralMatches += 1
        if (params.strictImports) signals.strictStructuralMatches += 1
      }
      filterMatches.imports = {
        matched: matched.length > 0,
        mode: params.strictImports ? "ast-metadata-strict" : "metadata",
        value: matched.length > 0 ? matched : importFilters,
      }
    }

    if (params.semanticKind) {
      const semanticKind = typeof metadata.semanticKind === "string" ? metadata.semanticKind : ""
      const requestedSemanticKinds = expandSemanticKindFilter(params.semanticKind)
      const accepted = requestedSemanticKinds.length > 0 ? requestedSemanticKinds : [params.semanticKind]
      const matched = accepted.includes(semanticKind)
      if (matched) whyMatched.add(`semantic kind matched: ${semanticKind}`)
      if (matched) {
        signals.semanticKindMatch = true
        signals.structuralMatches += 1
      }
      filterMatches.semanticKind = {
        matched,
        mode: "metadata",
        value: semanticKind || accepted,
      }
    }

    if (symbolQuery) {
      const matched = symbolName.toLowerCase().includes(symbolQuery.toLowerCase())
      if (matched) whyMatched.add(`symbol name matched: ${symbolName}`)
      if (matched) {
        signals.symbolFilterMatch = true
        signals.structuralMatches += 1
        signals.exactSymbolMatch = symbolName.toLowerCase() === symbolQuery.toLowerCase()
      }
      filterMatches.symbol = { matched, mode: "metadata", value: symbolName || symbolQuery }
    }

    if (params.isAsync !== undefined) {
      filterMatches.async = { matched: metadata.isAsync === params.isAsync, mode: "metadata", value: metadata.isAsync }
    }

    if (metadata.semanticKind) whyMatched.add(`semantic kind: ${metadata.semanticKind}`)
    if (metadata.framework) whyMatched.add(`framework: ${metadata.framework}`)
    if (score <= 0) whyMatched.add("weak semantic score")

    const confidence = calibratedConfidence(score, signals)

    return {
      ...result,
      confidence,
      isWeakMatch: confidence === "low" && (score <= 0 || score < 0.25),
      whyMatched: [...whyMatched],
      filterMatches: Object.keys(filterMatches).length > 0 ? filterMatches : undefined,
    }
  })
}

export function getMeaningfulPathSegments(file: string): string[] {
  return canonicalizeProjectFilePath(file)
    .split("/")
    .filter(Boolean)
    .filter((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase()))
}

export function deriveDomainLabel(result: WorkingResult): string {
  const segments = getMeaningfulPathSegments(result.file).map((segment) => segment.toLowerCase())
  const imports = getImportHints(result.metadata)
  const symbolType = typeof result.metadata.symbolType === "string" ? result.metadata.symbolType : ""

  const hasSegment = (...values: string[]) => values.some((value) => segments.includes(value))
  const hasImport = (...values: string[]) => values.some((value) => imports.includes(value))

  if (hasSegment("middleware", "middlewares", "guard", "guards")) return "middleware / guards"
  if (hasSegment("store", "stores", "state") || hasImport("pinia", "vuex", "redux", "zustand")) return "stores / state"
  if (hasSegment("service", "services", "api", "client", "clients") || hasImport("axios", "fetch", "ky")) return "services / api"
  if (hasSegment("type", "types", "model", "models", "dto", "dtos", "schema", "schemas", "entity", "entities", "contract", "contracts")) return "types / contracts"
  if (hasSegment("composable", "composables", "hook", "hooks")) return "composables / hooks"
  if (hasSegment("route", "routes", "router", "controller", "controllers", "endpoint", "endpoints")) return "endpoints / routing"
  if (hasSegment("repository", "repositories", "dao", "daos", "persistence", "database", "db")) return "persistence / data"
  if (hasSegment("component", "components", "page", "pages", "view", "views", "screen", "screens")) return "ui / pages"

  if (symbolType === "type" || symbolType === "enum") return "types / contracts"

  const fallback = getMeaningfulPathSegments(result.file).at(-2) ?? getMeaningfulPathSegments(result.file).at(-1)
  if (!fallback) return "related code"
  return `domain / ${fallback.replace(/[-_]/g, " ")}`
}

export function topCounts(values: Iterable<string>, maxItems = 3, skip = new Set<string>()): string[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (!normalized || skip.has(normalized)) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxItems)
    .map(([value]) => value)
}

export function selectRepresentatives(results: WorkingResult[], maxItems: number): WorkingResult[] {
  const sorted = [...results].sort((a, b) => b.semanticScore - a.semanticScore)
  const selected: WorkingResult[] = []
  const seenFiles = new Set<string>()

  for (const result of sorted) {
    if (selected.length >= maxItems) break
    if (seenFiles.has(result.file)) continue
    selected.push(result)
    seenFiles.add(result.file)
  }

  if (selected.length < maxItems) {
    for (const result of sorted) {
      if (selected.length >= maxItems) break
      if (selected.some((existing) => existing.file === result.file && existing.startLine === result.startLine && existing.endLine === result.endLine)) {
        continue
      }
      selected.push(result)
    }
  }

  return selected
}

export function buildPrecomputedRegionsMap(meta: IndexMeta, files: string[]): Map<string, TreeShaker.CollapsibleRegion[]> | undefined {
  const map = new Map<string, TreeShaker.CollapsibleRegion[]>()
  for (const file of files) {
    const fileStat = meta.files[file]
    if (fileStat?.collapsibleRegions) {
      map.set(file, fileStat.collapsibleRegions as TreeShaker.CollapsibleRegion[])
    }
  }
  return map.size > 0 ? map : undefined
}

export async function shakeRepresentativeResults(
  resources: SearchResources,
  results: WorkingResult[],
): Promise<
  Array<{
    file: string
    shakedContent: string
    originalResults: Array<{
      file: string
      startLine: number
      endLine: number
      content: string
      metadata: Record<string, unknown>
    }>
    stats: Awaited<ReturnType<typeof TreeShaker.shakeResults>>[number]["stats"]
  }>
> {
  const precomputed = buildPrecomputedRegionsMap(resources.meta, [...new Set(results.map((result) => result.file))])
  return TreeShaker.shakeResults(
    results.map((result) => ({
      file: result.file,
      startLine: result.startLine,
      endLine: result.endLine,
      content: result.content,
      metadata: result.metadata as Record<string, unknown>,
    })),
    Instance.directory,
    precomputed,
  )
}

export function formatCodeFence(content: string, maxLines: number): string[] {
  const lines = content.split("\n")
  const output = ["```"]
  for (const line of lines.slice(0, maxLines)) {
    output.push(line.length > MAX_LINE_LENGTH ? `${line.substring(0, MAX_LINE_LENGTH)}...` : line)
  }
  if (lines.length > maxLines) {
    output.push(`// ... (${lines.length - maxLines} more lines) ...`)
  }
  output.push("```")
  return output
}

export async function formatRepresentativeSnippets(
  resources: SearchResources,
  representatives: WorkingResult[],
  options: {
    shake: boolean
    shakedMaxLines?: number
    rawMaxLines?: number
  },
): Promise<string[]> {
  const lines: string[] = []
  if (options.shake) {
    const shaked = await shakeRepresentativeResults(resources, representatives)
    for (const fileResult of shaked) {
      const statsInfo = fileResult.stats.collapsedRegions > 0
        ? ` (${fileResult.stats.hiddenLines} lines hidden in ${fileResult.stats.collapsedRegions} regions)`
        : ""
      lines.push(`### ${fileResult.file}${statsInfo}`)
      const matchLabels = fileResult.originalResults
        .map((result) => [result.metadata.symbolName, result.metadata.symbolType].filter(Boolean).join(" "))
        .filter(Boolean)
      if (matchLabels.length > 0) lines.push(`Matches: ${matchLabels.join(", ")}`)
      lines.push(...formatCodeFence(fileResult.shakedContent, options.shakedMaxLines ?? 100))
    }
    return lines
  }

  for (const representative of representatives) {
    const symbolLabel = [representative.metadata.symbolName, representative.metadata.symbolType].filter(Boolean).join(", ")
    const heading = symbolLabel
      ? `${representative.file}:${representative.startLine} (${symbolLabel})`
      : `${representative.file}:${representative.startLine}-${representative.endLine}`
    lines.push(`### ${heading}`)
    lines.push(...formatCodeFence(representative.content, options.rawMaxLines ?? 40))
  }
  return lines
}

export function formatGroupedResultHeader(input: {
  title: string
  hits: number
  files: number
  symbolTypes: string[]
  imports: string[]
  signals: string[]
  whyGrouped: string[]
  domains?: string[]
}): string[] {
  const metaParts = [`Hits: ${input.hits}`, `Files: ${input.files}`]
  if (input.domains?.length) metaParts.push(`Domains: ${input.domains.join(", ")}`)
  if (input.symbolTypes.length > 0) metaParts.push(`Symbols: ${input.symbolTypes.join(", ")}`)
  if (input.imports.length > 0) metaParts.push(`Imports: ${input.imports.join(", ")}`)
  if (input.signals.length > 0) metaParts.push(`Signals: ${input.signals.join(", ")}`)

  return [
    `## ${input.title}`,
    metaParts.join(" | "),
    `Why grouped: ${input.whyGrouped.join(" | ")}`,
  ]
}

export function getGroupingReasons(input: {
  fallback: string
  imports: string[]
  symbols: string[]
  symbolTypes?: string[]
  domains?: string[]
  includeSimilarityReason?: boolean
}): string[] {
  const reasons: string[] = []
  const domains = input.domains ? topCounts(input.domains, 3) : []
  const imports = topCounts(input.imports, 3)
  const symbols = topCounts(input.symbols, 3)
  const symbolTypes = input.symbolTypes ? topCounts(input.symbolTypes, 2) : []

  if (domains.length > 0) reasons.push(`shared domains: ${domains.join(", ")}`)
  if (imports.length > 0) reasons.push(`shared imports/signals: ${imports.join(", ")}`)
  if (symbols.length > 0) reasons.push(`shared symbol terms: ${symbols.join(", ")}`)
  if (symbolTypes.length > 0) reasons.push(`dominant symbol types: ${symbolTypes.join(", ")}`)
  if (input.includeSimilarityReason) reasons.push("embedding/path/metadata similarity")
  if (reasons.length === 0) reasons.push(input.fallback)
  return reasons
}

export async function runGroupedSearch<TGroup>(input: {
  params: CommonSensegrepParams & {
    limit?: number
    rawLimit?: number
    shake?: boolean
    jsonDetail?: "summary" | "representatives" | "full"
  }
  heading: string
  groupLabel: string
  resultKey: "groups" | "clusters"
  defaultRawLimit: number
  rawLimitMultiplier: number
  prepareResults?: (resources: SearchResources, results: WorkingResult[]) => Promise<WorkingResult[]>
  buildGroups: (results: WorkingResult[]) => TGroup[]
  formatGroup: (resources: SearchResources, group: TGroup) => Promise<string[]>
  mapGroup: (group: TGroup) => Record<string, unknown>
  metadata?: (groups: TGroup[]) => Record<string, unknown>
  signal?: AbortSignal
}) {
  return withIndexedSearchResources(input.params.query, async (resources) => {
    const limit = input.params.limit ?? 5
    const rawLimit = Math.max(input.params.rawLimit ?? input.defaultRawLimit, limit * input.rawLimitMultiplier)
    const collected = await collectWorkingResults(resources, input.params, {
      rawLimit,
      diversify: false,
      signal: input.signal,
    })

    if ("output" in collected) return collected
    const rawResults = collected.results.slice(0, rawLimit)
    if (rawResults.length === 0) {
      return {
        title: input.params.query,
        metadata: { matches: 0, indexed: true, [input.resultKey]: 0, freshness: resources.freshness },
        freshness: resources.freshness,
        output: prependFreshnessWarning("No matching results found for your query.", resources.freshness),
      }
    }

    const preparedResults = input.prepareResults
      ? await input.prepareResults(resources, rawResults)
      : rawResults
    const groups = input.buildGroups(preparedResults).slice(0, limit)
    const fileCount = new Set(preparedResults.map((result) => result.file)).size
    const outputLines = [
      `${input.heading} for: ${input.params.query}`,
      "",
      `Found ${groups.length} ${input.groupLabel} from ${preparedResults.length} matches across ${fileCount} files`,
      "",
    ]

    for (const group of groups) {
      outputLines.push(...(await input.formatGroup(resources, group)))
    }

    return {
      title: input.params.query,
      metadata: {
        indexed: true,
        [input.resultKey]: groups.length,
        matches: preparedResults.length,
        files: fileCount,
        shaked: input.params.shake !== false,
        jsonDetail: input.params.jsonDetail ?? "representatives",
        freshness: resources.freshness,
        ...(input.metadata?.(groups) ?? {}),
      },
      freshness: resources.freshness,
      [input.resultKey]: groups.map(input.mapGroup),
      output: prependFreshnessWarning(outputLines.join("\n"), resources.freshness),
    }
  })
}

export function toStructuredSearchResult(result: WorkingResult): StructuredSearchResult {
  const metadata = result.metadata
  return {
    file: result.file,
    startLine: result.startLine,
    endLine: result.endLine,
    score: Number((result.rerankScore ?? result.semanticScore).toFixed(6)),
    rawDistance: typeof result.rawDistance === "number" ? Number(result.rawDistance.toFixed(6)) : undefined,
    distanceMetric: result.distanceMetric,
    symbolName: typeof metadata.symbolName === "string" && metadata.symbolName ? metadata.symbolName : undefined,
    symbolType: typeof metadata.symbolType === "string" && metadata.symbolType ? metadata.symbolType : undefined,
    type: typeof metadata.type === "string" && metadata.type ? metadata.type : undefined,
    language: typeof metadata.language === "string" && metadata.language ? metadata.language : undefined,
    parentScope: typeof metadata.parentScope === "string" && metadata.parentScope ? metadata.parentScope : undefined,
    imports: splitListField(metadata.imports),
    semanticKind: typeof metadata.semanticKind === "string" && metadata.semanticKind ? metadata.semanticKind : undefined,
    framework: typeof metadata.framework === "string" && metadata.framework ? metadata.framework : undefined,
    confidence: result.confidence ?? scoreToConfidence(result.rerankScore ?? result.semanticScore),
    isWeakMatch: result.isWeakMatch ?? (result.rerankScore ?? result.semanticScore) < 0.25,
    whyMatched: result.whyMatched ?? [],
    filterMatches: result.filterMatches,
    content: result.content,
    metadata,
  }
}

export function cosineSimilarity(a?: number[], b?: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function pathSimilarity(a: string, b: string): number {
  const aSegments = canonicalizeProjectFilePath(a).split("/").filter(Boolean)
  const bSegments = canonicalizeProjectFilePath(b).split("/").filter(Boolean)
  const maxLength = Math.max(aSegments.length, bSegments.length, 1)
  let prefix = 0
  while (prefix < aSegments.length && prefix < bSegments.length && aSegments[prefix] === bSegments[prefix]) {
    prefix += 1
  }
  return prefix / maxLength
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const value of setA) {
    if (setB.has(value)) intersection += 1
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

export function metadataSimilarity(a: WorkingResult, b: WorkingResult): number {
  let score = 0
  let weight = 0

  if (a.metadata.symbolType || b.metadata.symbolType) {
    weight += 1
    if (a.metadata.symbolType === b.metadata.symbolType) score += 1
  }
  if (a.metadata.language || b.metadata.language) {
    weight += 1
    if (a.metadata.language === b.metadata.language) score += 1
  }
  if (a.metadata.parentScope || b.metadata.parentScope) {
    weight += 1
    if (a.metadata.parentScope && a.metadata.parentScope === b.metadata.parentScope) score += 1
  }

  return weight === 0 ? 0 : score / weight
}
