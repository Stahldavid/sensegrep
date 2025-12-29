import * as vscode from "vscode"
import path from "node:path"
import { pathToFileURL } from "node:url"
import fs from "node:fs"
import picomatch from "picomatch"

type CoreModule = typeof import("@sensegrep/core")
const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<any>
let corePromise: Promise<CoreModule> | null = null

async function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    corePromise = (async () => {
      const candidates = [
        path.join(__dirname, "core", "index.js"),
        path.join(__dirname, "..", "node_modules", "@sensegrep", "core", "dist", "index.js"),
        path.join(__dirname, "..", "..", "core", "dist", "index.js"),
      ]

      const existing = candidates.filter((candidate) => fs.existsSync(candidate))
      if (existing.length > 0) {
        const errors: string[] = []
        for (const candidate of existing) {
          try {
            return await dynamicImport(pathToFileURL(candidate).href)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            errors.push(`${candidate}: ${message}`)
          }
        }
        throw new Error(
          `Failed to load bundled core from:\n${errors.join("\n")}`,
        )
      }

      try {
        return await dynamicImport("@sensegrep/core")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to load @sensegrep/core from node_modules: ${message}`)
      }
    })()
  }
  return corePromise
}

export interface SearchResult {
  file: string
  startLine: number
  endLine: number
  content: string
  symbolName?: string
  symbolType?: string
  relevance: number
  rerankScore?: number
  complexity?: number
  isExported?: boolean
  parentScope?: string
}

export interface SearchOptions {
  pattern?: string
  limit?: number
  include?: string
  exclude?: string
  symbolType?: string
  symbol?: string
  minScore?: number
  language?: string
  parentScope?: string
  imports?: string
  maxPerFile?: number
  maxPerSymbol?: number
  isExported?: boolean
  minComplexity?: number
  maxComplexity?: number
  hasDocumentation?: boolean
  rerank?: boolean
  shakeOutput?: boolean
}

export interface SearchSummaryGap {
  folder: string
  totalFiles: number
  matchedFiles: number
  coverage: number
}

export interface SearchSummary {
  totalResults: number
  fileCount: number
  symbolCount: number
  indexed: boolean
  gaps: SearchSummaryGap[]
}

export interface ShakedSearchFile {
  file: string
  content: string
  stats: {
    totalLines: number
    visibleLines: number
    collapsedRegions: number
    hiddenLines: number
  }
  matchCount: number
}

export interface DuplicateGroup {
  level: "exact" | "high" | "medium" | "low"
  similarity: number
  category?: string
  isLikelyOk?: boolean
  instances: Array<{
    file: string
    symbol: string
    content: string
    startLine: number
    endLine: number
    complexity?: number
    symbolType?: string
  }>
  impact: {
    totalLines: number
    complexity: number
    fileCount: number
    estimatedSavings: number
    score: number
  }
}

export interface IndexResult {
  mode: "full" | "incremental"
  files: number
  chunks: number
  skipped?: number
  removed?: number
  duration: number
}

export interface IndexStats {
  indexed: boolean
  files: number
  chunks: number
  lastIndexed?: string
  embeddings?: {
    provider: string
    model: string
    dimension: number
  }
}

export interface IndexStatus {
  indexed: boolean
  files: number
  chunks: number
  embeddings?: {
    provider: string
    model?: string
    dimension: number
    device?: string
  }
  updatedAt?: number
}

export interface IndexVerification {
  indexed: boolean
  files: number
  changed: number
  missing: number
  removed: number
  embeddings?: {
    provider: string
    model?: string
    dimension: number
    device?: string
  }
  updatedAt?: number
}

export class SensegrepCore {
  private context: vscode.ExtensionContext
  private rootDir: string
  private isInitialized = false
  private watcherStop: (() => Promise<void>) | null = null

  constructor(context: vscode.ExtensionContext, rootDir: string) {
    this.context = context
    this.rootDir = rootDir
  }

  private resolveRootDir(): string {
    const config = vscode.workspace.getConfiguration("sensegrep")
    const override = config.get<string>("indexRoot")
    if (override && override.trim().length > 0) {
      return path.isAbsolute(override)
        ? override
        : path.join(this.rootDir, override)
    }
    return this.rootDir
  }

  private async ensureInitialized() {
    if (this.isInitialized) return

    // Set up environment from settings
    await this.applySettings()
    this.isInitialized = true
  }

  private async applySettings() {
    const config = vscode.workspace.getConfiguration("sensegrep")

    // Set Gemini API key from settings or secret storage
    let apiKey = config.get<string>("geminiApiKey")
    if (!apiKey) {
      apiKey = await this.context.secrets.get("sensegrep.geminiApiKey")
    }
    if (apiKey) {
      process.env.GEMINI_API_KEY = apiKey
    }

    const explicitSetting = <T>(key: string): T | undefined => {
      const inspected = config.inspect<T>(key)
      if (!inspected) return undefined
      if (inspected.workspaceFolderValue !== undefined) return inspected.workspaceFolderValue
      if (inspected.workspaceValue !== undefined) return inspected.workspaceValue
      if (inspected.globalValue !== undefined) return inspected.globalValue
      return undefined
    }

    const explicitProvider = explicitSetting<string>("embeddings.provider")
    const explicitModel = explicitSetting<string>("embeddings.model")
    const explicitDim = explicitSetting<number>("embeddings.dimension")
    const explicitDevice = explicitSetting<string>("embeddings.device")
    const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
    const wantsGemini = explicitProvider === "gemini" || (!explicitProvider && hasGeminiKey)

    // Apply provider settings
    if (explicitProvider) {
      process.env.SENSEGREP_PROVIDER = explicitProvider
    } else if (wantsGemini && process.env.SENSEGREP_PROVIDER === "local") {
      delete process.env.SENSEGREP_PROVIDER
    }

    if (explicitModel) {
      process.env.SENSEGREP_EMBED_MODEL = explicitModel
    } else if (wantsGemini && process.env.SENSEGREP_EMBED_MODEL === "BAAI/bge-small-en-v1.5") {
      delete process.env.SENSEGREP_EMBED_MODEL
    }

    if (explicitDim) {
      process.env.SENSEGREP_EMBED_DIM = String(explicitDim)
    } else if (wantsGemini && process.env.SENSEGREP_EMBED_DIM === "384") {
      delete process.env.SENSEGREP_EMBED_DIM
    }

    if (explicitDevice) {
      process.env.SENSEGREP_EMBED_DEVICE = explicitDevice
    } else if (wantsGemini && process.env.SENSEGREP_EMBED_DEVICE) {
      delete process.env.SENSEGREP_EMBED_DEVICE
    }

    const logLevel = config.get<string>("logLevel")
    if (logLevel) {
      const { Log } = await loadCore()
      await Log.init({ print: true, level: logLevel as any })
    }
  }

  async reloadSettings(): Promise<void> {
    await this.applySettings()
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store("sensegrep.geminiApiKey", apiKey)
    process.env.GEMINI_API_KEY = apiKey
    vscode.window.showInformationMessage("Sensegrep: Gemini API key saved securely")
  }

  async getApiKey(): Promise<string | undefined> {
    return await this.context.secrets.get("sensegrep.geminiApiKey")
  }

  async clearApiKey(): Promise<void> {
    await this.context.secrets.delete("sensegrep.geminiApiKey")
    delete process.env.GEMINI_API_KEY
    vscode.window.showInformationMessage("Sensegrep: Gemini API key cleared")
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    await this.ensureInitialized()

    try {
      const rootDir = this.resolveRootDir()
      const config = vscode.workspace.getConfiguration("sensegrep")
      const defaultSymbolTypes = config.get<string[]>("defaultSymbolTypes") || []
      const excludePatterns = config.get<string[]>("excludePatterns") || []
      const maxResultsPerFile = config.get<number>("maxResultsPerFile")

      const { SenseGrepTool, Instance } = await loadCore()
      const tool = await SenseGrepTool.init()
      const result = await Instance.provide({
        directory: rootDir,
        fn: () =>
          tool.execute(
            {
              query,
              limit: options?.limit ?? 20,
              pattern: options?.pattern,
              include: options?.include,
              symbolType: options?.symbolType,
              symbol: options?.symbol,
              minScore: options?.minScore,
              language: options?.language as any,
              parentScope: options?.parentScope,
              imports: options?.imports,
              isExported: options?.isExported,
              minComplexity: options?.minComplexity,
              maxComplexity: options?.maxComplexity,
              hasDocumentation: options?.hasDocumentation,
              rerank: options?.rerank ?? false,
              shake: false,
              maxPerFile: options?.maxPerFile ?? maxResultsPerFile ?? 3,
              maxPerSymbol: options?.maxPerSymbol ?? 2,
            },
            {
              sessionID: "vscode",
              messageID: "search",
              agent: "sensegrep-vscode",
              abort: new AbortController().signal,
              metadata: () => {},
            }
          ),
      })

      let results = this.parseSearchOutput(result.output)

      if (!options?.symbolType && defaultSymbolTypes.length > 0) {
        const allowed = new Set(defaultSymbolTypes)
        results = results.filter((r) => r.symbolType && allowed.has(r.symbolType))
      }

      const parsePatterns = (value?: string): string[] => {
        if (!value) return []
        return value
          .split(/[,\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      }

      if (excludePatterns.length > 0) {
        const isExcluded = picomatch(excludePatterns, { dot: true })
        results = results.filter((r) => !isExcluded(r.file))
      }

      const excludeInput = parsePatterns(options?.exclude)
      if (excludeInput.length > 0) {
        const isExcluded = picomatch(excludeInput, { dot: true })
        results = results.filter((r) => !isExcluded(r.file))
      }

      if (options?.maxPerFile === undefined && typeof maxResultsPerFile === "number" && maxResultsPerFile > 0) {
        const perFile = new Map<string, number>()
        results = results.filter((r) => {
          const count = perFile.get(r.file) ?? 0
          if (count >= maxResultsPerFile) return false
          perFile.set(r.file, count + 1)
          return true
        })
      }

      return results
    } catch (err) {
      console.error("Search failed:", err)
      throw err
    }
  }

  private parseSearchOutput(output: string): SearchResult[] {
    const results: SearchResult[] = []
    const sections = output.split(/^## /m).filter(Boolean)

    for (const section of sections) {
      const lines = section.split("\n")
      const header = lines[0]

      const headerMatch = header.match(/^(.+?):(\d+)(?:-(\d+))?\s*(?:\(([^,]+),?\s*([^)]+)?\))?/)
      if (!headerMatch) continue

      const [, file, startLine, endLine, symbolName, symbolType] = headerMatch

      const metaLine = lines.find((l) => l.includes("Relevance:"))
      const relevanceMatch = metaLine?.match(/Relevance:\s*([\d.]+)%/)
      const relevance = relevanceMatch ? parseFloat(relevanceMatch[1]) / 100 : 0.5

      const rerankMatch = metaLine?.match(/Rerank:\s*([\d.]+)/i)
      const rerankScore = rerankMatch ? parseFloat(rerankMatch[1]) : undefined

      const complexityMatch = metaLine?.match(/Complexity:\s*(\d+)/)
      const complexity = complexityMatch ? parseInt(complexityMatch[1]) : undefined

      const parentMatch = metaLine?.match(/(?:^|\|)\s*in\s+([^|]+)\s*$/i)
      const parentScope = parentMatch ? parentMatch[1].trim() : undefined

      const codeStart = lines.findIndex((l) => l.trim() === "```")
      const codeEnd = lines.findIndex((l, i) => i > codeStart && l.trim() === "```")
      const content = codeStart > 0 && codeEnd > codeStart ? lines.slice(codeStart + 1, codeEnd).join("\n") : ""

      results.push({
        file,
        startLine: parseInt(startLine),
        endLine: parseInt(endLine || startLine),
        content,
        symbolName,
        symbolType,
        relevance,
        rerankScore,
        complexity,
        parentScope,
      })
    }

    return results
  }

  async detectDuplicates(options?: {
    threshold?: number
    scope?: string
    ignoreTests?: boolean
    crossFileOnly?: boolean
    onlyExported?: boolean
    minLines?: number
    minComplexity?: number
    excludePattern?: string
    normalizeIdentifiers?: boolean
    rankByImpact?: boolean
    ignoreAcceptablePatterns?: boolean
  }): Promise<{
    summary: {
      totalDuplicates: number
      byLevel: Record<string, number>
      totalSavings: number
      filesAffected: number
    }
    duplicates: DuplicateGroup[]
    acceptableDuplicates?: DuplicateGroup[]
  }> {
    await this.ensureInitialized()

    const rootDir = this.resolveRootDir()
    const config = vscode.workspace.getConfiguration("sensegrep")
    const threshold = options?.threshold ?? config.get<number>("duplicateThreshold") ?? 0.85

    const { DuplicateDetector, Instance } = await loadCore()
    const scopeFilter =
      options?.scope === "all"
        ? []
        : options?.scope
          ? [options.scope as any]
          : ["function", "method"]

    const result = await Instance.provide({
      directory: rootDir,
      fn: () =>
        DuplicateDetector.detect({
          path: rootDir,
          thresholds: {
            exact: 0.98,
            high: 0.9,
            medium: 0.85,
            low: threshold,
          },
          scopeFilter,
          ignoreTests: options?.ignoreTests ?? true,
          crossFileOnly: options?.crossFileOnly ?? false,
          onlyExported: options?.onlyExported ?? false,
          minLines: options?.minLines ?? 10,
          minComplexity: options?.minComplexity ?? 0,
          excludePattern: options?.excludePattern,
          normalizeIdentifiers: options?.normalizeIdentifiers ?? true,
          rankByImpact: options?.rankByImpact ?? true,
          ignoreAcceptablePatterns: options?.ignoreAcceptablePatterns ?? false,
        }),
    })

    return result
  }

  async indexProject(full: boolean = false): Promise<IndexResult> {
    await this.ensureInitialized()

    const { Indexer, Instance } = await loadCore()
    const result = await Instance.provide({
      directory: this.resolveRootDir(),
      fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
    })

    return {
      mode: full ? "full" : "incremental",
      files: result.files ?? 0,
      chunks: result.chunks ?? 0,
      skipped: result.skipped,
      removed: result.removed,
      duration: result.duration ?? 0,
    }
  }

  async getStats(): Promise<IndexStats> {
    await this.ensureInitialized()

    try {
      const { Indexer, Instance } = await loadCore()
      const stats = await Instance.provide({
        directory: this.resolveRootDir(),
        fn: () => Indexer.getStats(),
      })

      return {
        indexed: true,
        files: stats.files ?? 0,
        chunks: stats.chunks ?? 0,
        lastIndexed: stats.updatedAt ? new Date(stats.updatedAt).toISOString() : undefined,
        embeddings: stats.embeddings,
      }
    } catch {
      return {
        indexed: false,
        files: 0,
        chunks: 0,
      }
    }
  }

  async verifyIndex(): Promise<boolean> {
    await this.ensureInitialized()

    try {
      const { Indexer, Instance } = await loadCore()
      const result = await Instance.provide({
        directory: this.resolveRootDir(),
        fn: () => Indexer.verifyIndex(),
      })
      return result.indexed === true && result.changed === 0 && result.missing === 0 && result.removed === 0
    } catch {
      return false
    }
  }

  async getStatus(): Promise<IndexStatus> {
    await this.ensureInitialized()
    const { Indexer, Instance } = await loadCore()
    return await Instance.provide({
      directory: this.resolveRootDir(),
      fn: () => Indexer.getStats(),
    })
  }

  async verifyIndexDetailed(): Promise<IndexVerification> {
    await this.ensureInitialized()
    const { Indexer, Instance } = await loadCore()
    return await Instance.provide({
      directory: this.resolveRootDir(),
      fn: () => Indexer.verifyIndex(),
    })
  }

  async getCollapsibleRegions(
    filePath: string,
    options?: { fallbackToParse?: boolean }
  ) {
    await this.ensureInitialized()
    const { VectorStore } = await loadCore()
    const rootDir = this.resolveRootDir()
    const meta = await VectorStore.readIndexMeta(rootDir)

    const relativePath = path.isAbsolute(filePath)
      ? path.relative(rootDir, filePath)
      : filePath
    const regions = meta?.files?.[relativePath]?.collapsibleRegions ?? null
    if (regions || !options?.fallbackToParse) return regions

    try {
      const { TreeShaker } = await loadCore()
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(rootDir, filePath)
      const content = await fs.promises.readFile(absolutePath, "utf8")
      return await TreeShaker.extractRegions(absolutePath, content)
    } catch {
      return null
    }
  }

  async getIndexedFiles(): Promise<string[] | null> {
    await this.ensureInitialized()
    try {
      const { VectorStore } = await loadCore()
      const meta = await VectorStore.readIndexMeta(this.resolveRootDir())
      return meta?.files ? Object.keys(meta.files) : null
    } catch {
      return null
    }
  }

  async shakeSearchResults(results: SearchResult[]): Promise<ShakedSearchFile[]> {
    await this.ensureInitialized()
    if (results.length === 0) return []

    const rootDir = this.resolveRootDir()
    const { TreeShaker, VectorStore } = await loadCore()
    const indexMeta = await VectorStore.readIndexMeta(rootDir)
    const precomputedRegionsMap = new Map<string, any>()

    if (indexMeta?.files) {
      for (const result of results) {
        const fileStat = indexMeta.files[result.file]
        if (fileStat?.collapsibleRegions) {
          precomputedRegionsMap.set(result.file, fileStat.collapsibleRegions)
        }
      }
    }

    const shaked = await TreeShaker.shakeResults(
      results.map((r) => ({
        file: r.file,
        startLine: r.startLine,
        endLine: r.endLine,
        content: r.content,
        metadata: {},
      })),
      rootDir,
      precomputedRegionsMap.size > 0 ? precomputedRegionsMap : undefined
    )

    return shaked.map((entry: any) => ({
      file: entry.file,
      content: entry.shakedContent,
      stats: entry.stats,
      matchCount: entry.originalResults?.length ?? 0,
    }))
  }

  async deleteIndex(): Promise<void> {
    await this.ensureInitialized()
    const { VectorStore } = await loadCore()
    await VectorStore.deleteCollection(this.resolveRootDir())
  }

  async getMostRecentIndexedProject(): Promise<string | null> {
    await this.ensureInitialized()
    const { VectorStore } = await loadCore()
    return await VectorStore.getMostRecentIndexedProject()
  }

  async subscribeIndexProgress(
    callback: (event: {
      phase: "scanning" | "indexing" | "complete" | "error"
      current: number
      total: number
      file?: string
      message?: string
    }) => void
  ): Promise<() => void> {
    await this.ensureInitialized()
    const { Bus, Indexer } = await loadCore()
    return Bus.subscribe(Indexer.Event.Progress, (event: any) => {
      callback(event.properties as any)
    })
  }

  async startIndexWatcher(options: {
    intervalMs: number
    onIndex: (result: IndexResult) => void
    onError?: (error: unknown) => void
  }): Promise<void> {
    await this.ensureInitialized()
    const { IndexWatcher } = await loadCore()
    if (this.watcherStop) {
      await this.watcherStop()
    }
    const handle = await IndexWatcher.start({
      rootDir: this.resolveRootDir(),
      intervalMs: options.intervalMs,
      onIndex: options.onIndex as any,
      onError: options.onError,
    })
    this.watcherStop = handle.stop
  }

  async stopIndexWatcher(): Promise<void> {
    if (this.watcherStop) {
      await this.watcherStop()
      this.watcherStop = null
    }
  }

  getRootDir(): string {
    return this.resolveRootDir()
  }

  dispose() {
    void this.stopIndexWatcher()
    // Clean up resources
  }
}
