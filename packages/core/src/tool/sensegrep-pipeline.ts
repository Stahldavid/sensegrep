import path from "path"
import { spawn } from "node:child_process"
import { once } from "node:events"
import picomatch from "picomatch"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { Ripgrep } from "../file/ripgrep.js"
import { TreeShaker } from "../semantic/tree-shaker.js"

export type ResultMetadata = Record<string, string | number | boolean | string[] | undefined>

export type WorkingResult = {
  id?: string
  file: string
  content: string
  startLine: number
  endLine: number
  semanticScore: number
  metadata: ResultMetadata
  rerankScore?: number
  vector?: number[]
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
  language?: "typescript" | "javascript" | "python" | "java" | "vue"
  parentScope?: string
  imports?: string
  shake?: boolean
}

type IndexMeta = NonNullable<Awaited<ReturnType<typeof VectorStore.readIndexMeta>>>

export type SearchResources = {
  meta: IndexMeta
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>
}

type ToolLikeResult = {
  title: string
  metadata: Record<string, unknown>
  output: string
}

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

export async function withIndexedSearchResources<T extends ToolLikeResult>(
  query: string,
  fn: (resources: SearchResources) => Promise<T>,
): Promise<T> {
  const meta = await VectorStore.readIndexMeta(Instance.directory)
  if (!meta || !meta.embeddings) {
    return {
      title: query,
      metadata: { matches: 0, indexed: false },
      output:
        "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
    } as unknown as T
  }

  const indexConfig = {
    provider: meta.embeddings.provider,
    embedModel: meta.embeddings.model,
    embedDim: meta.embeddings.dimension,
  }

  return Embeddings.withConfig(indexConfig as any, async () => {
    VectorStore.clearProjectCache(Instance.directory)
    const collection = await VectorStore.getCollectionUnsafe(Instance.directory, meta.embeddings.dimension)
    return fn({ meta, collection })
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

// Batch ripgrep file arguments to avoid command line length limits (notably on Windows).
const RIPGREP_MAX_ARG_CHARS = process.platform === "win32" ? 7000 : 30000
const RIPGREP_MAX_FILES_PER_BATCH = 256

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
      if (!match) continue

      const [, matchedPath, lineNum, text] = match
      matches.push({
        file: canonicalizeProjectFilePath(matchedPath),
        line: parseInt(lineNum, 10),
        text: text.trim(),
      })
    }
  }

  return matches
}

function buildSearchFilters(params: CommonSensegrepParams): VectorStore.SearchFilters {
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
    filters.all!.push({ key: "parentScope", operator: "equals", value: params.parentScope })
  }
  if (params.imports) {
    filters.all!.push({ key: "imports", operator: "contains", value: params.imports })
  }

  const symbolQuery = params.symbol ?? params.name
  if (symbolQuery) {
    filters.all!.push({ key: "symbolName", operator: "contains", value: symbolQuery })
  }

  return filters
}

function resolveFileFiltering(meta: IndexMeta, params: CommonSensegrepParams, filters: VectorStore.SearchFilters): FileFilterContext | ToolLikeResult {
  let includeMatcher: ReturnType<typeof createGlobMatcher> | undefined
  let excludeMatcher: ReturnType<typeof createGlobMatcher> | undefined
  if (params.include) includeMatcher = createGlobMatcher(params.include)
  if (params.exclude) excludeMatcher = createGlobMatcher(params.exclude)

  if (!includeMatcher && !excludeMatcher) {
    return { includeMatcher, excludeMatcher }
  }

  const indexedFiles = Object.keys(meta.files ?? {})
  const candidateFiles = indexedFiles.filter((file) => {
    const normalized = canonicalizeProjectFilePath(file)
    if (includeMatcher && !includeMatcher(normalized)) return false
    if (excludeMatcher && excludeMatcher(normalized)) return false
    return true
  })

  if (candidateFiles.length === 0) {
    const filterLabel = [
      params.include ? `include="${params.include}"` : null,
      params.exclude ? `exclude="${params.exclude}"` : null,
    ]
      .filter(Boolean)
      .join(", ")

    return {
      title: params.query,
      metadata: { matches: 0, indexed: true },
      output: `No indexed files matched the file filters${filterLabel ? ` (${filterLabel})` : ""}.`,
    }
  }

  filters.all!.push({
    key: "file",
    operator: "in",
    value: [...new Set(candidateFiles.flatMap((file) => expandFilePathVariants(file)))],
  })

  return { includeMatcher, excludeMatcher, candidateFiles }
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

function buildFiltersWithFileVariants(filters: VectorStore.SearchFilters, filePath: string): VectorStore.SearchFilters {
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

async function collectLiteralFallbackResults(
  query: string,
  files: string[],
  collection: Awaited<ReturnType<typeof VectorStore.getCollectionUnsafe>>,
  filters: VectorStore.SearchFilters,
): Promise<WorkingResult[]> {
  const rgMatches = await runRipgrepOnFiles(query, files, { caseSensitive: true, fixedStrings: true })
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
        semanticScore: 1.05,
        metadata: selected.metadata,
      })
    }
  }

  return [...results.values()]
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
): Promise<{ results: WorkingResult[]; filters: VectorStore.SearchFilters; candidateFiles?: string[] } | ToolLikeResult> {
  const filters = buildSearchFilters(params)
  const fileFiltering = resolveFileFiltering(resources.meta, params, filters)
  if ("output" in fileFiltering) return fileFiltering

  const searchOptions: { limit: number; filters?: VectorStore.SearchFilters } = {
    limit: options.rawLimit,
  }
  if (filters.all && filters.all.length > 0) {
    searchOptions.filters = filters
  }

  let semanticResults = await VectorStore.search(resources.collection, params.query, searchOptions)

  if (fileFiltering.includeMatcher) {
    semanticResults = semanticResults.filter((result) =>
      fileFiltering.includeMatcher!(canonicalizeProjectFilePath(result.metadata.file as string)),
    )
  }
  if (fileFiltering.excludeMatcher) {
    semanticResults = semanticResults.filter((result) =>
      !fileFiltering.excludeMatcher!(canonicalizeProjectFilePath(result.metadata.file as string)),
    )
  }

  const shouldRunLiteralFallback = !params.pattern && queryLooksLikeIdentifier(params.query)
  let literalFallbackResults: WorkingResult[] = []
  if (shouldRunLiteralFallback) {
    const lexicalCandidateFiles =
      fileFiltering.candidateFiles ??
      Object.keys(resources.meta.files ?? {}).filter((file) => {
        const normalized = canonicalizeProjectFilePath(file)
        if (fileFiltering.includeMatcher && !fileFiltering.includeMatcher(normalized)) return false
        if (fileFiltering.excludeMatcher && fileFiltering.excludeMatcher(normalized)) return false
        return true
      })

    literalFallbackResults = await collectLiteralFallbackResults(
      params.query,
      lexicalCandidateFiles,
      resources.collection,
      filters,
    )
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

  let workingResults: WorkingResult[] = filteredResults.map((result) => ({
    id: result.id,
    file: result.metadata.file as string,
    content: result.content,
    startLine: result.metadata.startLine as number,
    endLine: result.metadata.endLine as number,
    semanticScore: 1 - result.distance,
    metadata: result.metadata,
  }))

  if (literalFallbackResults.length > 0) {
    const merged = new Map<string, WorkingResult>()
    for (const result of workingResults) {
      merged.set(`${result.file}:${result.startLine}:${result.endLine}`, result)
    }
    for (const result of literalFallbackResults) {
      const key = `${result.file}:${result.startLine}:${result.endLine}`
      const existing = merged.get(key)
      if (existing) {
        merged.set(key, {
          ...existing,
          id: existing.id ?? result.id,
          semanticScore: Math.max(existing.semanticScore, result.semanticScore),
        })
      } else {
        merged.set(key, result)
      }
    }
    workingResults = [...merged.values()]
  }

  workingResults.sort((a, b) => b.semanticScore - a.semanticScore)

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
