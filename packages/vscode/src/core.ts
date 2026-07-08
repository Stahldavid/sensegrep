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
  type?: string
  language?: string
  imports?: string[]
  metadata?: Record<string, unknown>
  relevance: number
  rerankScore?: number
  complexity?: number
  isExported?: boolean
  parentScope?: string
}

export interface ThematicGroup {
  title: string
  score: number
  matches: number
  files: string[]
  imports?: string[]
  symbols?: string[]
  domains?: string[]
  symbolTypes?: string[]
  results: SearchResult[]
}

export interface ThematicResult {
  title: string
  metadata: Record<string, unknown>
  output: string
  groups?: ThematicGroup[]
  clusters?: ThematicGroup[]
}

export interface SearchOptions {
  pattern?: string
  limit?: number
  include?: string
  exclude?: string
  symbolType?: "function" | "class" | "method" | "type" | "variable" | "enum" | "module"
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
  // Multilingual support fields
  variant?: string
  decorator?: string
  isAsync?: boolean
  isStatic?: boolean
  isAbstract?: boolean
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
    language?: string
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
    model?: string
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
  }
  updatedAt?: number
}

export interface CollapsibleRegion {
  type: "method" | "function" | "constructor" | "arrow_function"
  name: string
  startLine: number
  endLine: number
  signatureEndLine: number
  indentation: string
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
    const explicitBaseUrl = explicitSetting<string>("embeddings.baseUrl")
    const explicitApiKey = explicitSetting<string>("embeddings.apiKey")
    const explicitRegion = explicitSetting<string>("embeddings.region")

    // Only push embedding env vars when the user explicitly set them in VS Code.
    // Otherwise ~/.config/sensegrep/config.json is the source of truth (e.g. LM Studio).
    if (explicitProvider === "gemini" || explicitProvider === "openai" || explicitProvider === "bedrock" || explicitProvider === "ollama") {
      process.env.SENSEGREP_PROVIDER = explicitProvider
    } else {
      delete process.env.SENSEGREP_PROVIDER
    }

    if (explicitModel) {
      process.env.SENSEGREP_EMBED_MODEL = explicitModel
    } else {
      delete process.env.SENSEGREP_EMBED_MODEL
    }

    if (explicitDim !== undefined && explicitDim > 0) {
      process.env.SENSEGREP_EMBED_DIM = String(explicitDim)
    } else {
      delete process.env.SENSEGREP_EMBED_DIM
    }

    if (explicitBaseUrl) {
      if (explicitProvider === "ollama") {
        process.env.SENSEGREP_OLLAMA_BASE_URL = explicitBaseUrl
        delete process.env.SENSEGREP_OPENAI_BASE_URL
      } else {
        process.env.SENSEGREP_OPENAI_BASE_URL = explicitBaseUrl
        delete process.env.SENSEGREP_OLLAMA_BASE_URL
      }
    } else {
      delete process.env.SENSEGREP_OPENAI_BASE_URL
      delete process.env.SENSEGREP_OLLAMA_BASE_URL
    }

    if (explicitApiKey) {
      process.env.SENSEGREP_OPENAI_API_KEY = explicitApiKey
    } else {
      delete process.env.SENSEGREP_OPENAI_API_KEY
    }

    if (explicitRegion) {
      process.env.SENSEGREP_BEDROCK_REGION = explicitRegion
    } else {
      delete process.env.SENSEGREP_BEDROCK_REGION
    }

    // Gemini key only when the user explicitly chose Gemini in settings.
    if (explicitProvider === "gemini") {
      let geminiKey = config.get<string>("geminiApiKey")
      if (!geminiKey) {
        geminiKey = await this.context.secrets.get("sensegrep.geminiApiKey")
      }
      if (geminiKey) {
        process.env.GEMINI_API_KEY = geminiKey
      } else {
        delete process.env.GEMINI_API_KEY
      }
    } else {
      delete process.env.GEMINI_API_KEY
    }

    if (process.env.SENSEGREP_EMBED_DEVICE) {
      delete process.env.SENSEGREP_EMBED_DEVICE
    }

    const logLevel = config.get<string>("logLevel")
    if (logLevel) {
      const { Log } = await loadCore()
      await Log.init({ print: true, level: logLevel as any })
    }
  }

  async reloadSettings(): Promise<void> {
    this.isInitialized = false
    await this.applySettings()
    this.isInitialized = true
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

  async getLanguageCapabilities(): Promise<{
    languages: Array<{ id: string; name: string }>
    variants: Array<{ name: string; language: string; description: string }>
    decorators: Array<{ name: string; language: string; description: string }>
  }> {
    try {
      const core = await loadCore()

      // Check if capabilities functions are available
      if (!core.getLanguageCapabilities) {
        // Fallback to default capabilities
        return {
          languages: [
            { id: "typescript", name: "TypeScript" },
            { id: "javascript", name: "JavaScript" },
            { id: "python", name: "Python" },
            { id: "java", name: "Java" },
            { id: "vue", name: "Vue" },
          ],
          variants: [],
          decorators: []
        }
      }

      const capabilities = core.getLanguageCapabilities()

      // Support both old per-language capability arrays and the newer
      // aggregated capability object exposed by @sensegrep/core.
      if (Array.isArray(capabilities)) {
        return {
          languages: capabilities.map((cap: any) => ({
            id: cap.language,
            name: cap.language.charAt(0).toUpperCase() + cap.language.slice(1)
          })),
          variants: capabilities.flatMap((cap: any) =>
            (cap.variants || []).map((v: any) => ({
              name: v.name,
              language: cap.language,
              description: v.description
            }))
          ),
          decorators: capabilities.flatMap((cap: any) =>
            (cap.decorators || []).map((d: any) => ({
              name: typeof d === "string" ? d : d.name,
              language: cap.language,
              description: typeof d === "string" ? `Decorator ${d}` : d.description
            }))
          )
        }
      }

      const languageNames = Array.isArray(capabilities?.languageNames)
        ? capabilities.languageNames
        : []
      const languages = languageNames.length > 0
        ? languageNames.map((lang: any) => ({
          id: lang.id,
          name: lang.displayName || (lang.id?.charAt(0).toUpperCase() + lang.id?.slice(1))
        }))
        : (Array.isArray(capabilities?.languages) ? capabilities.languages : []).map((id: string) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1)
        }))

      const variants = (Array.isArray(capabilities?.variants) ? capabilities.variants : []).flatMap((variant: any) => {
        const langs = Array.isArray(variant.languages) && variant.languages.length > 0
          ? variant.languages
          : ["all"]
        return langs.map((language: string) => ({
          name: variant.name,
          language,
          description: variant.description
        }))
      })

      const decorators = (Array.isArray(capabilities?.decorators) ? capabilities.decorators : []).map((decorator: any) => ({
        name: typeof decorator === "string" ? decorator : decorator.name,
        language: "all",
        description: typeof decorator === "string"
          ? `Decorator ${decorator}`
          : (decorator.description || `Decorator ${decorator.name}`)
      }))

      return {
        languages,
        variants,
        decorators
      }
    } catch (err) {
      console.error("Failed to get language capabilities:", err)
      // Fallback to defaults
      return {
        languages: [
          { id: "typescript", name: "TypeScript" },
          { id: "javascript", name: "JavaScript" },
          { id: "python", name: "Python" },
          { id: "java", name: "Java" },
          { id: "vue", name: "Vue" },
        ],
        variants: [],
        decorators: []
      }
    }
  }

  async search(query: string, options?: SearchOptions, abort?: AbortSignal): Promise<SearchResult[]> {
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
              exclude: options?.exclude,
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
              // Multilingual support fields
              variant: options?.variant,
              decorator: options?.decorator,
              isAsync: options?.isAsync,
              isStatic: options?.isStatic,
              isAbstract: options?.isAbstract,
            },
            {
              sessionID: "vscode",
              messageID: "search",
              agent: "sensegrep-vscode",
              abort: abort ?? new AbortController().signal,
              metadata: () => {},
            }
          ),
      })

      let results: SearchResult[] = Array.isArray((result as any).results)
        ? (result as any).results.map((entry: any) => this.mapStructuredSearchResult(entry))
        : this.parseSearchOutput(result.output)

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
    crossLanguage?: boolean
    language?: string
    maxCandidates?: number
  }): Promise<{
    summary: {
      totalDuplicates: number
      byLevel: Record<string, number>
      totalSavings: number
      filesAffected: number
      candidates?: number
      analyzedCandidates?: number
      truncated?: boolean
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
          crossLanguage: options?.crossLanguage ?? false,
          language: options?.language,
          maxCandidates: options?.maxCandidates,
        }),
    })

    return result
  }

  async indexProject(full: boolean = false): Promise<IndexResult> {
    await this.ensureInitialized()

    const { Indexer, Instance } = await loadCore()
    this.applyIndexOptions(Indexer)
    const result = await Instance.provide({
      directory: this.resolveRootDir(),
      fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
    })

    const deltaFields = result as {
      skipped?: number
      removed?: number
    }

    return {
      mode: full ? "full" : "incremental",
      files: result.files ?? 0,
      chunks: result.chunks ?? 0,
      skipped: deltaFields.skipped,
      removed: deltaFields.removed,
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
  ): Promise<CollapsibleRegion[] | null> {
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
    const { IndexWatcher, Indexer } = await loadCore()
    this.applyIndexOptions(Indexer)
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

  async testEmbeddings(): Promise<{
    provider?: string
    model?: string
    dimension?: number
    vectorLength: number
  }> {
    await this.ensureInitialized()
    const { Embeddings } = await loadCore()
    const vectors = await Embeddings.embed("sensegrep vscode embeddings smoke test", {
      taskType: "CODE_RETRIEVAL_QUERY",
    } as any)
    const config = typeof Embeddings.getConfig === "function" ? Embeddings.getConfig() : undefined
    return {
      provider: config?.provider,
      model: config?.embedModel,
      dimension: config?.embedDim,
      vectorLength: vectors[0]?.length ?? 0,
    }
  }

  private mapStructuredSearchResult(entry: any): SearchResult {
    const metadata = entry?.metadata && typeof entry.metadata === "object"
      ? entry.metadata as Record<string, unknown>
      : {}
    const score = typeof entry?.score === "number"
      ? entry.score
      : typeof entry?.relevance === "number"
        ? entry.relevance
        : 0.5
    const complexity = typeof metadata.complexity === "number"
      ? metadata.complexity
      : typeof entry?.complexity === "number"
        ? entry.complexity
        : undefined
    const isExported = typeof metadata.isExported === "boolean"
      ? metadata.isExported
      : typeof entry?.isExported === "boolean"
        ? entry.isExported
        : undefined

    return {
      file: String(entry?.file ?? ""),
      startLine: Number(entry?.startLine ?? 1),
      endLine: Number(entry?.endLine ?? entry?.startLine ?? 1),
      content: String(entry?.content ?? ""),
      symbolName: entry?.symbolName,
      symbolType: entry?.symbolType,
      type: entry?.type,
      language: entry?.language,
      imports: Array.isArray(entry?.imports) ? entry.imports.map(String) : undefined,
      metadata,
      relevance: score,
      rerankScore: typeof entry?.rerankScore === "number" ? entry.rerankScore : undefined,
      complexity,
      isExported,
      parentScope: entry?.parentScope,
    }
  }

  async survey(
    query: string,
    options?: SearchOptions & { rawLimit?: number; perGroup?: number },
    abort?: AbortSignal
  ): Promise<ThematicResult> {
    await this.ensureInitialized()
    const rootDir = this.resolveRootDir()
    const { SenseGrepSurveyTool, Instance } = await loadCore()
    const tool = await SenseGrepSurveyTool.init()
    const result = await Instance.provide({
      directory: rootDir,
      fn: () =>
        tool.execute(
          {
            ...this.toThematicParams(query, options),
            rawLimit: options?.rawLimit,
            perGroup: options?.perGroup,
          },
          {
            sessionID: "vscode",
            messageID: "survey",
            agent: "sensegrep-vscode",
            abort: abort ?? new AbortController().signal,
            metadata: () => {},
          }
        ),
    })
    return this.mapThematicResult(result, "groups")
  }

  async cluster(
    query: string,
    options?: SearchOptions & {
      rawLimit?: number
      perCluster?: number
      clusterThreshold?: number
      minClusterSize?: number
    },
    abort?: AbortSignal
  ): Promise<ThematicResult> {
    await this.ensureInitialized()
    const rootDir = this.resolveRootDir()
    const { SenseGrepClusterTool, Instance } = await loadCore()
    const tool = await SenseGrepClusterTool.init()
    const result = await Instance.provide({
      directory: rootDir,
      fn: () =>
        tool.execute(
          {
            ...this.toThematicParams(query, options),
            rawLimit: options?.rawLimit,
            perCluster: options?.perCluster,
            clusterThreshold: options?.clusterThreshold,
            minClusterSize: options?.minClusterSize,
          },
          {
            sessionID: "vscode",
            messageID: "cluster",
            agent: "sensegrep-vscode",
            abort: abort ?? new AbortController().signal,
            metadata: () => {},
          }
        ),
    })
    return this.mapThematicResult(result, "clusters")
  }

  private toThematicParams(query: string, options?: SearchOptions) {
    return {
      query,
      pattern: options?.pattern,
      limit: options?.limit,
      include: options?.include,
      exclude: options?.exclude,
      minScore: options?.minScore,
      symbol: options?.symbol,
      symbolType: options?.symbolType,
      language: options?.language as any,
      parentScope: options?.parentScope,
      imports: options?.imports,
      isExported: options?.isExported,
      minComplexity: options?.minComplexity,
      maxComplexity: options?.maxComplexity,
      hasDocumentation: options?.hasDocumentation,
      variant: options?.variant,
      decorator: options?.decorator,
      isAsync: options?.isAsync,
      isStatic: options?.isStatic,
      isAbstract: options?.isAbstract,
      shake: options?.shakeOutput !== false,
    }
  }

  private mapThematicResult(result: any, key: "groups" | "clusters"): ThematicResult {
    const mapGroup = (group: any): ThematicGroup => ({
      title: String(group?.title ?? "related code"),
      score: Number(group?.score ?? 0),
      matches: Number(group?.matches ?? 0),
      files: Array.isArray(group?.files) ? group.files.map(String) : [],
      imports: Array.isArray(group?.imports) ? group.imports.map(String) : undefined,
      symbols: Array.isArray(group?.symbols) ? group.symbols.map(String) : undefined,
      domains: Array.isArray(group?.domains) ? group.domains.map(String) : undefined,
      symbolTypes: Array.isArray(group?.symbolTypes) ? group.symbolTypes.map(String) : undefined,
      results: Array.isArray(group?.results)
        ? group.results.map((entry: any) => this.mapStructuredSearchResult(entry))
        : [],
    })
    const mapped = Array.isArray(result?.[key]) ? result[key].map(mapGroup) : []
    return {
      title: String(result?.title ?? ""),
      metadata: result?.metadata && typeof result.metadata === "object" ? result.metadata : {},
      output: String(result?.output ?? ""),
      [key]: mapped,
    }
  }

  private applyIndexOptions(Indexer: { setIndexOptions?: (options: { includeDocs?: boolean; includeConfig?: boolean }) => void }) {
    const config = vscode.workspace.getConfiguration("sensegrep")
    Indexer.setIndexOptions?.({
      includeDocs: config.get<boolean>("includeDocs") ?? false,
      includeConfig: config.get<boolean>("includeConfig") ?? false,
    })
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
