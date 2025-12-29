import * as vscode from "vscode"
import { SensegrepCore, DuplicateGroup } from "../core"
import { getDuplicatesViewHtml, getNonce } from "../webview/templates"
import { DuplicateDiagnosticsManager } from "../providers/duplicate-diagnostics"
import { tryRecoverIndex } from "../providers/index-repair"

export class DuplicatesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "sensegrep.duplicates"

  private _view?: vscode.WebviewView
  private lastDuplicates: DuplicateGroup[] = []
  private lastAcceptable: DuplicateGroup[] = []
  private lastSummary:
    | { totalDuplicates: number; byLevel: Record<string, number>; totalSavings: number; filesAffected: number }
    | null = null
  private lastDisplayOptions: {
    limit?: number
    showCode?: boolean
    fullCode?: boolean
    showAcceptable?: boolean
  } = {}

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly core: SensegrepCore,
    private readonly diagnostics: DuplicateDiagnosticsManager
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
    webviewView.webview.html = getDuplicatesViewHtml(webviewView.webview, nonce)

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "analyze":
          await this.analyze(message.options ?? {})
          break
        case "goToInstance":
          await this.goToInstance(message.groupIdx, message.instanceIdx, message.kind)        
          break
        case "compareGroup":
          await this.compareGroup(message.groupIdx, message.kind)
          break
      }
    })
  }

  async analyze(
    options: {
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
    limit?: number
    showCode?: boolean
    fullCode?: boolean
    showAcceptable?: boolean
  },
    allowRetry: boolean = true
  ) {
    try {
      const {
        limit,
        showCode,
        fullCode,
        showAcceptable,
        ...detectOptions
      } = options
      const result = await this.core.detectDuplicates(detectOptions)
      const effectiveLimit = typeof limit === "number" && limit > 0 ? limit : undefined
      const displayDuplicates = effectiveLimit
        ? result.duplicates.slice(0, effectiveLimit)
        : result.duplicates
      const acceptable = result.acceptableDuplicates ?? []

      this.lastDuplicates = displayDuplicates
      this.lastAcceptable = acceptable
      this.lastSummary = result.summary
      this.lastDisplayOptions = { limit: effectiveLimit, showCode, fullCode, showAcceptable }
      this.diagnostics.update(result.duplicates, showAcceptable === false ? [] : acceptable)
      this._view?.webview.postMessage({
        type: "results",
        data: {
          ...result,
          duplicates: displayDuplicates,
          acceptableDuplicates: showAcceptable === false ? [] : acceptable,
          display: {
            shown: displayDuplicates.length,
            total: result.duplicates.length,
            limit: effectiveLimit,
          },
        },
        options: this.lastDisplayOptions,
      })
    } catch (err) {
      if (
        allowRetry &&
        (await tryRecoverIndex(this.core, err, undefined, async () => {
          await this.analyze(options, false)
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

  async showResults(
    duplicates: DuplicateGroup[],
    summary: { totalDuplicates: number; byLevel: Record<string, number>; totalSavings: number; filesAffected: number },
    acceptableDuplicates: DuplicateGroup[] = []
  ) {
    this.lastDuplicates = duplicates
    this.lastAcceptable = acceptableDuplicates
    this.lastSummary = summary
    this.lastDisplayOptions = {}
    this.diagnostics.update(duplicates, acceptableDuplicates)
    this._view?.webview.postMessage({
      type: "results",
      data: {
        duplicates,
        summary,
        acceptableDuplicates,
        display: { shown: duplicates.length, total: duplicates.length },
      },
      options: this.lastDisplayOptions,
    })
  }

  private async goToInstance(groupIdx: number, instanceIdx: number, kind?: string) {
    const source = kind === "acceptable" ? this.lastAcceptable : this.lastDuplicates
    const group = source[groupIdx]
    const instance = group?.instances?.[instanceIdx]
    if (!instance) return
    await vscode.commands.executeCommand(
      "sensegrep.goToDuplicate",
      instance.file,
      instance.startLine,
      instance.endLine
    )
  }

  private async compareGroup(groupIdx: number, kind?: string) {
    const source = kind === "acceptable" ? this.lastAcceptable : this.lastDuplicates
    const group = source[groupIdx]
    if (!group) return
    await vscode.commands.executeCommand("sensegrep.compareDuplicates", group)
  }

  getExportPayload() {
    if (!this.lastSummary || this.lastDuplicates.length === 0) return null
    return {
      summary: this.lastSummary,
      duplicates: this.lastDuplicates,
      acceptableDuplicates: this.lastAcceptable,
      display: this.lastDisplayOptions,
    }
  }
}
