import * as vscode from "vscode"
import { SensegrepCore, SearchResult, SearchSummary, ShakedSearchFile } from "../core"
import type { SearchOptions } from "../core"
import { ResultsTreeProvider } from "../providers/results-tree"
import { HistoryTreeProvider } from "../providers/history-tree"
import { getNonce, getSearchViewHtml } from "../webview/templates"
import { tryRecoverIndex } from "../providers/index-repair"
import * as path from "path"

export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "sensegrep.search"

  private _view?: vscode.WebviewView
  private lastResults: SearchResult[] = []
  private lastQuery: string | null = null
  private lastOptions: SearchOptions | null = null
  private lastSummary: SearchSummary | null = null
  private lastShaked: ShakedSearchFile[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly core: SensegrepCore,
    private readonly resultsProvider: ResultsTreeProvider,
    private readonly historyProvider: HistoryTreeProvider
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    const nonce = getNonce()
    webviewView.webview.html = getSearchViewHtml(webviewView.webview, nonce)
    this.renderLastResults()
    void this.updateApiKeyBanner()

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "search":
          await this.performSearch(message.query, message.options ?? message.filters ?? {})
          break
        case "saveSearch":
          await this.saveSearch(message.query, message.options ?? {})
          break
        case "goToResult":
          await this.goToResult(message.index)
          break
        case "expandResult":
          await this.expandResult(message.index)
          break
        case "setApiKey":
          await vscode.commands.executeCommand("sensegrep.setApiKey")
          break
        case "openSettings":
          await vscode.commands.executeCommand("sensegrep.openSettings")
          break
        case "getCapabilities":
          const capabilities = await this.core.getLanguageCapabilities()
          webviewView.webview.postMessage({
            type: "capabilities",
            capabilities
          })
          break
      }
    })
  }

  public async refreshApiKeyBanner() {
    await this.updateApiKeyBanner()
  }

  public async syncResults(
    query: string,
    options: SearchOptions | undefined,
    results: SearchResult[]
  ) {
    await this.applyResults(query, options ?? {}, results)
  }

  private async performSearch(
    query: string,
    filters: {
      symbolType?: string
      symbol?: string
      language?: string
      parentScope?: string
      imports?: string
      include?: string
      exclude?: string
      pattern?: string
      limit?: number
      minScore?: number
      maxPerFile?: number
      maxPerSymbol?: number
      isExported?: boolean
      hasDocumentation?: boolean
      minComplexity?: number
      maxComplexity?: number
      rerank?: boolean
      shakeOutput?: boolean
      // Multilingual support fields
      variant?: string
      decorator?: string
      isAsync?: boolean
      isStatic?: boolean
      isAbstract?: boolean
    },
    allowRetry: boolean = true
  ) {
    if (!query.trim()) return

    try {
      const results = await this.core.search(query, {
        symbolType: filters.symbolType,
        symbol: filters.symbol,
        language: filters.language,
        parentScope: filters.parentScope,
        imports: filters.imports,
        include: filters.include,
        exclude: filters.exclude,
        pattern: filters.pattern,
        limit: filters.limit,
        minScore: filters.minScore,
        maxPerFile: filters.maxPerFile,
        maxPerSymbol: filters.maxPerSymbol,
        isExported: filters.isExported,
        hasDocumentation: filters.hasDocumentation,
        minComplexity: filters.minComplexity,
        maxComplexity: filters.maxComplexity,
        rerank: filters.rerank,
        shakeOutput: filters.shakeOutput,
        // Multilingual support fields
        variant: filters.variant,
        decorator: filters.decorator,
        isAsync: filters.isAsync,
        isStatic: filters.isStatic,
        isAbstract: filters.isAbstract,
      })

      this.resultsProvider.setResults(results, query)
      this.historyProvider.addSearch(query, {
        symbolType: filters.symbolType,
        symbol: filters.symbol,
        language: filters.language,
        parentScope: filters.parentScope,
        imports: filters.imports,
        include: filters.include,
        exclude: filters.exclude,
        pattern: filters.pattern,
        limit: filters.limit,
        minScore: filters.minScore,
        maxPerFile: filters.maxPerFile,
        maxPerSymbol: filters.maxPerSymbol,
        isExported: filters.isExported,
        hasDocumentation: filters.hasDocumentation,
        minComplexity: filters.minComplexity,
        maxComplexity: filters.maxComplexity,
        rerank: filters.rerank,
        shakeOutput: filters.shakeOutput,
      })
      await this.applyResults(query, filters, results)
    } catch (err) {
      if (
        allowRetry &&
        (await tryRecoverIndex(this.core, err, undefined, async () => {
          await this.performSearch(query, filters, false)
        }))
      ) {
        return
      }
      this._view?.webview.postMessage({
        type: "error",
        message: String(err),
      })
    }
  }

  private async applyResults(
    query: string,
    filters: SearchOptions,
    results: SearchResult[]
  ) {
    this.lastResults = results
    this.lastQuery = query
    this.lastOptions = { ...filters }
    try {
      this.lastSummary = await this.buildSummary(results)
    } catch {
      this.lastSummary = {
        totalResults: results.length,
        fileCount: new Set(results.map((r) => r.file)).size,
        symbolCount: new Set(
          results
            .map((r) => r.symbolName)
            .filter((name): name is string => Boolean(name && name.trim()))
        ).size,
        indexed: false,
        gaps: [],
      }
    }
    if (filters.shakeOutput) {
      try {
        this.lastShaked = await this.core.shakeSearchResults(results)
      } catch {
        this.lastShaked = []
      }
    } else {
      this.lastShaked = []
    }

    this._view?.webview.postMessage({
      type: "results",
      results,
      summary: this.lastSummary,
      shakedFiles: this.lastShaked,
    })
  }

  private renderLastResults() {
    if (!this._view || !this.lastSummary || this.lastResults.length === 0) return
    this._view.webview.postMessage({
      type: "results",
      results: this.lastResults,
      summary: this.lastSummary,
      shakedFiles: this.lastShaked,
    })
  }

  private async buildSummary(results: SearchResult[]): Promise<SearchSummary> {
    const totalResults = results.length
    const fileSet = new Set(results.map((r) => r.file))
    const symbolSet = new Set(
      results
        .map((r) => r.symbolName)
        .filter((name): name is string => Boolean(name && name.trim()))
    )

    const indexedFiles = await this.core.getIndexedFiles()
    if (!indexedFiles) {
      return {
        totalResults,
        fileCount: fileSet.size,
        symbolCount: symbolSet.size,
        indexed: false,
        gaps: [],
      }
    }

    const normalize = (value: string) => value.replace(/\\/g, "/")
    const totalByFolder = new Map<string, number>()
    const matchedByFolder = new Map<string, number>()

    for (const file of indexedFiles) {
      const normalized = normalize(file)
      const folder = normalized.includes("/")
        ? normalized.split("/")[0]
        : "(root)"
      totalByFolder.set(folder, (totalByFolder.get(folder) ?? 0) + 1)
    }

    for (const file of fileSet) {
      const normalized = normalize(file)
      const folder = normalized.includes("/")
        ? normalized.split("/")[0]
        : "(root)"
      matchedByFolder.set(folder, (matchedByFolder.get(folder) ?? 0) + 1)
    }

    const gaps = Array.from(totalByFolder.entries()).map(([folder, total]) => {
      const matched = matchedByFolder.get(folder) ?? 0
      return {
        folder,
        totalFiles: total,
        matchedFiles: matched,
        coverage: total > 0 ? matched / total : 0,
      }
    })

    const zeroMatches = gaps.filter((g) => g.matchedFiles === 0)
    const ordered = (zeroMatches.length > 0 ? zeroMatches : gaps).sort((a, b) => {
      if (a.coverage !== b.coverage) return a.coverage - b.coverage
      return b.totalFiles - a.totalFiles
    })

    return {
      totalResults,
      fileCount: fileSet.size,
      symbolCount: symbolSet.size,
      indexed: true,
      gaps: ordered.slice(0, 5),
    }
  }

  private async goToResult(index: number) {
    const result = this.lastResults[index]
    if (!result) return
    await vscode.commands.executeCommand("sensegrep.goToResult", {
      result,
      query: this.lastQuery ?? undefined,
    })
  }

  private async expandResult(index: number) {
    const result = this.lastResults[index]
    if (!result || !this._view) return

    try {
      const rootDir = this.core.getRootDir()
      const filePath = path.isAbsolute(result.file)
        ? result.file
        : path.join(rootDir, result.file)
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
      let start = Math.max(0, result.startLine - 1)
      let end = Math.max(start, Math.min(doc.lineCount - 1, result.endLine - 1))
      const regions = await this.core.getCollapsibleRegions(filePath, { fallbackToParse: true })
      if (regions && regions.length > 0) {
        const candidate = regions
          .filter((region) => region.startLine <= result.startLine && region.endLine >= result.endLine)
          .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0]
        if (candidate) {
          start = Math.max(0, candidate.startLine - 1)
          end = Math.max(start, Math.min(doc.lineCount - 1, candidate.endLine - 1))
        }
      }
      const endChar = doc.lineAt(end).text.length
      const range = new vscode.Range(start, 0, end, endChar)
      const content = doc.getText(range)
      this._view.webview.postMessage({
        type: "resultExpanded",
        index,
        content,
      })
    } catch (err) {
      this._view.webview.postMessage({
        type: "resultExpandError",
        index,
        message: String(err),
      })
    }
  }

  private async updateApiKeyBanner() {
    if (!this._view) return
    const provider = this.getEffectiveProvider()
    const apiKey =
      (await this.core.getApiKey()) ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY
    if (provider === "gemini" && !apiKey) {
      this._view.webview.postMessage({ type: "showApiKeyBanner" })
    } else {
      this._view.webview.postMessage({ type: "hideApiKeyBanner" })
    }
  }

  private getEffectiveProvider(): "local" | "gemini" {
    const config = vscode.workspace.getConfiguration("sensegrep")
    const inspected = config.inspect<string>("embeddings.provider")
    const explicit =
      inspected?.workspaceFolderValue ??
      inspected?.workspaceValue ??
      inspected?.globalValue
    if (explicit === "gemini" || explicit === "local") return explicit
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini"
    return "local"
  }

  private async saveSearch(query: string, options: SearchOptions) {
    const tagInput = await vscode.window.showInputBox({
      prompt: "Tags for this search (comma-separated)",
      placeHolder: "auth, jwt, api",
    })
    if (tagInput === undefined) return
    const tags = tagInput
      ? tagInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []

    this.historyProvider.saveSearch({
      query,
      options,
      tags,
    })

    vscode.window.showInformationMessage("Search saved")
  }

  getExportPayload() {
    if (!this.lastQuery || this.lastResults.length === 0) return null
    return {
      query: this.lastQuery,
      options: this.lastOptions,
      summary: this.lastSummary,
      results: this.lastResults,
      shakedFiles: this.lastShaked,
    }
  }
}
