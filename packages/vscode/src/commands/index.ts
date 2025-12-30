import * as vscode from "vscode"
import { SensegrepCore, SearchResult, DuplicateGroup } from "../core"
import type { SearchOptions } from "../core"
import { ResultsTreeProvider } from "../providers/results-tree"
import { SearchViewProvider } from "../views/search-view"
import { DuplicatesViewProvider } from "../views/duplicates-view"
import { HistoryTreeProvider } from "../providers/history-tree"
import type { SearchRecord } from "../providers/history-tree"
import { StatusBarManager } from "../providers/statusbar"
import { DuplicateDiagnosticsManager } from "../providers/duplicate-diagnostics"
import { tryRecoverIndex } from "../providers/index-repair"
import { getNonce, getSettingsViewHtml } from "../webview/templates"
import * as path from "path"
import fs from "node:fs/promises"

export function registerCommands(
  context: vscode.ExtensionContext,
  core: SensegrepCore,
  resultsProvider: ResultsTreeProvider,
  searchViewProvider: SearchViewProvider,
  duplicatesViewProvider: DuplicatesViewProvider,
  duplicateDiagnostics: DuplicateDiagnosticsManager,
  historyProvider: HistoryTreeProvider,
  statusBar: StatusBarManager
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = []
  let settingsPanel: vscode.WebviewPanel | null = null

  const showSettingsPanel = async () => {
    if (settingsPanel) {
      settingsPanel.reveal()
      return
    }

    const panel = vscode.window.createWebviewPanel(
      "sensegrep.settings",
      "Sensegrep Settings",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    settingsPanel = panel

    const render = async () => {
      const config = vscode.workspace.getConfiguration("sensegrep")
      const inspected = config.inspect<string>("embeddings.provider")
      const explicit =
        inspected?.workspaceFolderValue ??
        inspected?.workspaceValue ??
        inspected?.globalValue
      const provider =
        explicit === "gemini" || explicit === "local"
          ? explicit
          : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
            ? "gemini"
            : "local"

      const apiKey = await core.getApiKey()
      const nonce = getNonce()
      panel.webview.html = getSettingsViewHtml(panel.webview, nonce, apiKey, provider)
    }

    panel.onDidDispose(() => {
      settingsPanel = null
    })

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "saveApiKey":
          if (message.apiKey) {
            await core.setApiKey(message.apiKey)
            panel.webview.postMessage({ type: "apiKeySaved" })
            await searchViewProvider.refreshApiKeyBanner()
          }
          break
        case "clearApiKey":
          await core.clearApiKey()
          panel.webview.postMessage({ type: "apiKeyCleared" })
          await searchViewProvider.refreshApiKeyBanner()
          break
        case "setProvider":
          if (message.provider === "local" || message.provider === "gemini") {
            const cfg = vscode.workspace.getConfiguration("sensegrep")
            await cfg.update(
              "embeddings.provider",
              message.provider,
              vscode.ConfigurationTarget.Workspace
            )
            await core.reloadSettings()
            panel.webview.postMessage({ type: "providerChanged", provider: message.provider })
            await searchViewProvider.refreshApiKeyBanner()
          }
          break
      }
    })

    await render()
  }

  // Search command
  disposables.push(
    vscode.commands.registerCommand("sensegrep.search", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Enter semantic search query",
        placeHolder: "e.g., authentication logic with JWT",
      })

      if (!query) return

      await performSearch(core, query, resultsProvider, searchViewProvider, historyProvider, statusBar)
    })
  )

  // Advanced search (QuickPick wizard)
  disposables.push(
    vscode.commands.registerCommand("sensegrep.searchAdvanced", async () => {   
      const request = await promptAdvancedSearch()
      if (!request) return
      await performSearch(
        core,
        request.query,
        resultsProvider,
        searchViewProvider,
        historyProvider,
        statusBar,
        request.options
      )
    })
  )

  // Export search results
  disposables.push(
    vscode.commands.registerCommand("sensegrep.exportSearchResults", async () => {
      const payload = searchViewProvider.getExportPayload()
      if (!payload) {
        vscode.window.showWarningMessage("No search results to export")
        return
      }

      const format = await promptExportFormat()
      if (!format) return

      const defaultName = `sensegrep-search.${format === "json" ? "json" : "md"}`
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(core.getRootDir(), defaultName)),
        filters: format === "json" ? { JSON: ["json"] } : { Markdown: ["md"] },
        saveLabel: "Export",
      })
      if (!uri) return

      const content =
        format === "json"
          ? JSON.stringify(payload, null, 2)
          : formatSearchMarkdown(payload)
      await fs.writeFile(uri.fsPath, content, "utf8")
      vscode.window.showInformationMessage(`Exported search results to ${uri.fsPath}`)
    })
  )

  // Save search
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.saveSearch",
      async (record?: SearchRecord | { record?: SearchRecord }) => {
        const resolved = resolveRecord(record)
        const input = resolved ?? historyProvider.getLastSearch()
        if (!input) {
          vscode.window.showWarningMessage("No recent search to save")
          return
        }

        const tagInput = await vscode.window.showInputBox({
          prompt: "Tags for this search (comma-separated)",
          placeHolder: "auth, jwt, api",
          value: input.tags?.join(", ") ?? "",
        })
        if (tagInput === undefined) return
        const tags = tagInput
          ? tagInput
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : []

        historyProvider.saveSearch({
          query: input.query,
          options: input.options,
          tags,
        })
        vscode.window.showInformationMessage("Search saved")
      }
    )
  )

  // Edit saved search tags
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.editSavedSearchTags",
      async (record: SearchRecord | { record?: SearchRecord }) => {
        const resolved = resolveRecord(record)
        if (!resolved?.id) return
        const tagInput = await vscode.window.showInputBox({
          prompt: "Edit tags (comma-separated)",
          placeHolder: "auth, jwt, api",
          value: resolved.tags?.join(", ") ?? "",
        })
        if (tagInput === undefined) return
        const tags = tagInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
        historyProvider.updateSavedTags(resolved.id, tags)
      }
    )
  )

  // Remove saved search
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.removeSavedSearch",
      async (record: SearchRecord | { record?: SearchRecord }) => {
        const resolved = resolveRecord(record)
        if (!resolved?.id) return
        historyProvider.removeSaved(resolved.id)
      }
    )
  )

  // Search selection (find similar)
  disposables.push(
    vscode.commands.registerCommand("sensegrep.searchSelection", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return

      const selection = editor.selection
      const selectedText = editor.document.getText(selection)

      if (!selectedText.trim()) {
        vscode.window.showWarningMessage("Please select some code first")
        return
      }

      // Use first line as query hint
      const firstLine = selectedText.split("\n")[0].trim()
      const query = `similar to: ${firstLine.substring(0, 100)}`

      await performSearch(core, query, resultsProvider, searchViewProvider, historyProvider, statusBar)
    })
  )

  // Fold unrelated code in active editor
  disposables.push(
    vscode.commands.registerCommand("sensegrep.foldUnrelated", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      await foldUnrelatedInEditor(core, editor)
    })
  )

  // Toggle semantic folding
  disposables.push(
    vscode.commands.registerCommand("sensegrep.toggleSemanticFolding", async () => {
      const config = vscode.workspace.getConfiguration("sensegrep")
      const current = config.get<boolean>("semanticFolding") ?? true
      const next = !current
      await config.update("semanticFolding", next, vscode.ConfigurationTarget.Workspace)
      statusBar.updateFoldingState(next)
      vscode.window.showInformationMessage(
        `Sensegrep semantic folding: ${next ? "enabled" : "disabled"}`
      )
      if (!next) {
        await unfoldAllVisibleEditors()
      }
    })
  )

  // Unfold all visible editors (internal)
  disposables.push(
    vscode.commands.registerCommand("sensegrep.unfoldAllEditors", async () => {
      await unfoldAllVisibleEditors()
    })
  )

  // Set index root (share index with CLI/MCP)
  disposables.push(
    vscode.commands.registerCommand("sensegrep.setIndexRoot", async () => {
      const config = vscode.workspace.getConfiguration("sensegrep")
      const current = config.get<string>("indexRoot") ?? ""

      const picks: Array<{ label: string; action: string; detail?: string }> = [
        { label: "Use workspace root", action: "workspace" },
        { label: "Pick folder...", action: "pick" },
        { label: "Use most recent indexed project", action: "recent" },
      ]
      if (current) {
        picks.push({ label: "Clear custom root", action: "clear", detail: current })
      }

      const choice = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select the root folder to share the index with CLI/MCP",
      })
      if (!choice) return

      if (choice.action === "workspace") {
        await config.update("indexRoot", "", vscode.ConfigurationTarget.Workspace)
        vscode.window.showInformationMessage("Sensegrep: using workspace root for index")
        return
      }

      if (choice.action === "clear") {
        await config.update("indexRoot", "", vscode.ConfigurationTarget.Workspace)
        vscode.window.showInformationMessage("Sensegrep: cleared custom index root")
        return
      }

      if (choice.action === "recent") {
        const recent = await core.getMostRecentIndexedProject()
        if (!recent) {
          vscode.window.showWarningMessage("No recent Sensegrep index found")
          return
        }
        await config.update("indexRoot", recent, vscode.ConfigurationTarget.Workspace)
        vscode.window.showInformationMessage(`Sensegrep: using index root ${recent}`)
        return
      }

      if (choice.action === "pick") {
        const selection = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: "Use this folder as index root",
        })
        if (!selection || selection.length === 0) return
        await config.update("indexRoot", selection[0].fsPath, vscode.ConfigurationTarget.Workspace)
        vscode.window.showInformationMessage(`Sensegrep: using index root ${selection[0].fsPath}`)
      }
    })
  )

  // Detect duplicates
  disposables.push(
    vscode.commands.registerCommand("sensegrep.detectDuplicates", async () => {
      statusBar.setAnalyzing()

      try {
        const result = await core.detectDuplicates()
        duplicateDiagnostics.update(result.duplicates)
        await duplicatesViewProvider.showResults(
          result.duplicates,
          result.summary,
          result.acceptableDuplicates ?? []
        )
        statusBar.setDuplicatesCount(result.summary.totalDuplicates)

        if (result.summary.totalDuplicates === 0) {
          vscode.window.showInformationMessage("No significant duplicates found!")
        } else {
          vscode.window.showInformationMessage(
            `Found ${result.summary.totalDuplicates} duplicate groups (${result.summary.totalSavings} lines could be saved)`
          )
        }
      } catch (err) {
        if (
          await tryRecoverIndex(core, err, statusBar, async () => {
            await vscode.commands.executeCommand("sensegrep.detectDuplicates")
          })
        ) {
          return
        }
        statusBar.setError(String(err))
        vscode.window.showErrorMessage(`Duplicate detection failed: ${err}`)
      }
    })
  )

  // Export duplicate results
  disposables.push(
    vscode.commands.registerCommand("sensegrep.exportDuplicateResults", async () => {
      const payload = duplicatesViewProvider.getExportPayload()
      if (!payload) {
        vscode.window.showWarningMessage("No duplicate results to export")
        return
      }

      const format = await promptExportFormat()
      if (!format) return

      const defaultName = `sensegrep-duplicates.${format === "json" ? "json" : "md"}`
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(core.getRootDir(), defaultName)),
        filters: format === "json" ? { JSON: ["json"] } : { Markdown: ["md"] },
        saveLabel: "Export",
      })
      if (!uri) return

      const content =
        format === "json"
          ? JSON.stringify(payload, null, 2)
          : formatDuplicateMarkdown(payload)
      await fs.writeFile(uri.fsPath, content, "utf8")
      vscode.window.showInformationMessage(`Exported duplicate results to ${uri.fsPath}`)
    })
  )

  // Index project
  disposables.push(
    vscode.commands.registerCommand("sensegrep.indexProject", async () => {
      statusBar.setIndexing()

      try {
        const result = await runIndexWithProgress(core, statusBar, false)
        statusBar.setIndexed(result.chunks)

        vscode.window.showInformationMessage(
          `Indexed ${result.files} files (${result.chunks} chunks) in ${(result.duration / 1000).toFixed(1)}s`
        )
      } catch (err) {
        statusBar.setError(String(err))
        vscode.window.showErrorMessage(`Indexing failed: ${err}`)
      }
    })
  )

  // Reindex project (full)
  disposables.push(
    vscode.commands.registerCommand("sensegrep.reindexProject", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "This will rebuild the entire index. Continue?",
        "Yes",
        "No"
      )

      if (confirm !== "Yes") return

      statusBar.setIndexing()

      try {
        const result = await runIndexWithProgress(core, statusBar, true)
        statusBar.setIndexed(result.chunks)

        vscode.window.showInformationMessage(
          `Full reindex: ${result.files} files (${result.chunks} chunks) in ${(result.duration / 1000).toFixed(1)}s`
        )
      } catch (err) {
        statusBar.setError(String(err))
        vscode.window.showErrorMessage(`Reindexing failed: ${err}`)
      }
    })
  )

  // Show stats
  disposables.push(
    vscode.commands.registerCommand("sensegrep.showStats", async () => {
      try {
        const lastError = statusBar.getLastError()
        if (lastError) {
          const action = await vscode.window.showErrorMessage(
            `Sensegrep error: ${lastError}`,
            "Show Stats"
          )
          if (action !== "Show Stats") {
            return
          }
        }

        const stats = await core.getStats()

        if (!stats.indexed) {
          vscode.window.showWarningMessage("Project not indexed. Run 'Sensegrep: Index Project' first.")
          return
        }

        const message = [
          `📊 Sensegrep Index Stats`,
          `Files: ${stats.files}`,
          `Chunks: ${stats.chunks}`,
          stats.embeddings ? `Model: ${stats.embeddings.model} (${stats.embeddings.dimension}d)` : "",
          stats.lastIndexed ? `Last indexed: ${new Date(stats.lastIndexed).toLocaleString()}` : "",
        ]
          .filter(Boolean)
          .join("\n")

        vscode.window.showInformationMessage(message)
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to get stats: ${err}`)
      }
    })
  )

  // Verify index integrity
  disposables.push(
    vscode.commands.registerCommand("sensegrep.verifyIndex", async () => {
      try {
        const result = await core.verifyIndexDetailed()
        if (!result.indexed) {
          vscode.window.showWarningMessage(
            "Sensegrep: no index found. Run 'Index Project' first."
          )
          return
        }

        const message = [
          `✅ Verify index`,
          `Files: ${result.files}`,
          `Changed: ${result.changed}`,
          `Missing: ${result.missing}`,
          `Removed: ${result.removed}`,
        ].join("\n")

        if (result.changed > 0 || result.missing > 0 || result.removed > 0) {
          const action = await vscode.window.showWarningMessage(
            `${message}\n\nReindex now?`,
            "Reindex Full",
            "Later"
          )
          if (action === "Reindex Full") {
            await vscode.commands.executeCommand("sensegrep.reindexProject")
          }
        } else {
          vscode.window.showInformationMessage(message)
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Verify failed: ${err}`)
      }
    })
  )

  // Show detailed status JSON
  disposables.push(
    vscode.commands.registerCommand("sensegrep.showStatusJson", async () => {
      try {
        const status = await core.getStatus()
        await openJsonDocument("Sensegrep Index Status", status)
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to get status: ${err}`)
      }
    })
  )

  // Toggle watch mode
  disposables.push(
    vscode.commands.registerCommand("sensegrep.toggleWatch", async () => {
      const config = vscode.workspace.getConfiguration("sensegrep")
      const current = config.get<boolean>("watchMode")
      await config.update("watchMode", !current, vscode.ConfigurationTarget.Workspace)
      vscode.window.showInformationMessage(`Sensegrep watch mode: ${!current ? "enabled" : "disabled"}`)
    })
  )

  // Open settings
  disposables.push(
    vscode.commands.registerCommand("sensegrep.openSettings", () => {
      void showSettingsPanel()
    })
  )

  // Set API key
  disposables.push(
    vscode.commands.registerCommand("sensegrep.setApiKey", async () => {
      const currentKey = await core.getApiKey()
      const hasKey = !!currentKey

      const action = await vscode.window.showQuickPick(
        [
          { label: "$(key) Set new API key", action: "set" },
          ...(hasKey ? [{ label: "$(trash) Clear API key", action: "clear" }] : []),
          { label: "$(link-external) Get API key from Google AI Studio", action: "open" },
        ],
        { placeHolder: hasKey ? "API key is set" : "No API key configured" }
      )

      if (!action) return

      if (action.action === "open") {
        vscode.env.openExternal(vscode.Uri.parse("https://aistudio.google.com/apikey"))
        return
      }

      if (action.action === "clear") {
        await core.clearApiKey()
        await searchViewProvider.refreshApiKeyBanner()
        return
      }

      const apiKey = await vscode.window.showInputBox({
        prompt: "Enter your Gemini API key",
        password: true,
        placeHolder: "AIza...",
        validateInput: (value) => {
          if (!value) return "API key is required"
          if (!value.startsWith("AIza")) return "Invalid API key format"
          return null
        },
      })

      if (apiKey) {
        await core.setApiKey(apiKey)
        await searchViewProvider.refreshApiKeyBanner()
      }
    })
  )

  // Refresh results
  disposables.push(
    vscode.commands.registerCommand("sensegrep.refreshResults", () => {
      resultsProvider.refresh()
    })
  )

  // Clear results
  disposables.push(
    vscode.commands.registerCommand("sensegrep.clearResults", () => {
      resultsProvider.clear()
    })
  )

  // Go to result
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.goToResult",
      async (payload: SearchResult | { result: SearchResult; query?: string }) => {
        const { result } = normalizeGoToResultPayload(payload)
        const filePath = path.isAbsolute(result.file) ? result.file : path.join(core.getRootDir(), result.file)

      const uri = vscode.Uri.file(filePath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(doc)

      await applySemanticFolding(core, editor, result)

      const startLine = Math.max(0, result.startLine - 1)
      const endLine = result.endLine - 1

      const range = new vscode.Range(startLine, 0, endLine, 0)
      editor.selection = new vscode.Selection(range.start, range.end)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter)

      // Highlight the range temporarily
      const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
        isWholeLine: true,
      })

      editor.setDecorations(decoration, [range])
      highlightResultContent(editor, range, result)

      // Remove highlight after 2 seconds
      setTimeout(() => {
        decoration.dispose()
      }, 2000)
    })
  )

  // Go to duplicate
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.goToDuplicate",
      async (file: string, startLine: number, endLine: number) => {
        const filePath = path.isAbsolute(file) ? file : path.join(core.getRootDir(), file)

        const uri = vscode.Uri.file(filePath)
        const doc = await vscode.workspace.openTextDocument(uri)
        const editor = await vscode.window.showTextDocument(doc)

        await applySemanticFolding(core, editor, {
          file,
          startLine,
          endLine,
          content: "",
          relevance: 1,
        })

        const range = new vscode.Range(Math.max(0, startLine - 1), 0, endLine - 1, 0)
        editor.selection = new vscode.Selection(range.start, range.end)
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
      }
    )
  )

  // Compare duplicates side by side
  disposables.push(
    vscode.commands.registerCommand("sensegrep.compareDuplicates", async (group: DuplicateGroup) => {
      try {
        if (!group?.instances || group.instances.length < 2) {
          vscode.window.showWarningMessage("Sensegrep: Not enough instances to compare.")
          return
        }

        let [a, b] = group.instances
        if (group.instances.length > 2) {
          const first = await pickDuplicateInstance("Select first instance", group.instances)
          if (!first) return
          const remaining = group.instances.filter((inst) => inst !== first)
          const second = await pickDuplicateInstance("Compare with", remaining)
          if (!second) return
          a = first
          b = second
        }
        const rootDir = core.getRootDir()

        const snippetA = await getSnippetDocument(a, rootDir)
        const snippetB = await getSnippetDocument(b, rootDir)

        const title = `${path.basename(a.file)}:${a.startLine} ↔ ${path.basename(b.file)}:${b.startLine}`
        await vscode.commands.executeCommand("vscode.diff", snippetA, snippetB, title)
      } catch (err) {
        vscode.window.showErrorMessage(`Sensegrep: Compare failed: ${err}`)
      }
    })
  )

  // Execute search from history
  disposables.push(
    vscode.commands.registerCommand(
      "sensegrep.executeSearch",
      async (input: string | SearchRecord) => {
        const query = typeof input === "string" ? input : input.query
        const options = typeof input === "string" ? undefined : input.options
        await performSearch(core, query, resultsProvider, searchViewProvider, historyProvider, statusBar, options)
      }
    )
  )

  return disposables
}

async function performSearch(
  core: SensegrepCore,
  query: string,
  resultsProvider: ResultsTreeProvider,
  searchViewProvider: SearchViewProvider,
  historyProvider: HistoryTreeProvider,
  statusBar: StatusBarManager,
  options?: SearchOptions
) {
  statusBar.setSearching()

  try {
    const results = await core.search(query, options)
    resultsProvider.setResults(results, query)
    historyProvider.addSearch(query, options)
    await searchViewProvider.syncResults(query, options, results)
    statusBar.setReady()

    if (results.length === 0) {
      vscode.window.showInformationMessage("No results found")
    }
  } catch (err) {
    if (
      await tryRecoverIndex(core, err, statusBar, async () => {
        await performSearch(core, query, resultsProvider, searchViewProvider, historyProvider, statusBar, options)
      })
    ) {
      return
    }
    statusBar.setError(String(err))
    vscode.window.showErrorMessage(`Search failed: ${err}`)
  }
}

async function promptAdvancedSearch(): Promise<{
  query: string
  options: SearchOptions
} | null> {
  const query = await vscode.window.showInputBox({
    prompt: "Semantic search query",
    placeHolder: "e.g., authentication logic with JWT",
  })
  if (!query) return null

  const language = await vscode.window.showQuickPick(
    ["", "typescript", "javascript", "tsx", "jsx"],
    { placeHolder: "Language (optional)" }
  )
  if (language === undefined) return null

  const symbol = await vscode.window.showInputBox({
    prompt: "Symbol name (optional)",
    placeHolder: "e.g., VectorStore",
  })
  if (symbol === undefined) return null

  const parentScope = await vscode.window.showInputBox({
    prompt: "Parent scope (optional)",
    placeHolder: "e.g., AuthService",
  })
  if (parentScope === undefined) return null

  const imports = await vscode.window.showInputBox({
    prompt: "Imports filter (optional)",
    placeHolder: "e.g., react",
  })
  if (imports === undefined) return null

  const minScoreInput = await vscode.window.showInputBox({
    prompt: "Minimum score 0-1 (optional)",
    placeHolder: "e.g., 0.6",
  })
  if (minScoreInput === undefined) return null

  const maxPerFileInput = await vscode.window.showInputBox({
    prompt: "Max results per file (optional)",
    placeHolder: "e.g., 3",
  })
  if (maxPerFileInput === undefined) return null

  const maxPerSymbolInput = await vscode.window.showInputBox({
    prompt: "Max results per symbol (optional)",
    placeHolder: "e.g., 2",
  })
  if (maxPerSymbolInput === undefined) return null

  const include = await vscode.window.showInputBox({
    prompt: "Include pattern (optional)",
    placeHolder: "e.g., src/**/*.ts",
  })
  if (include === undefined) return null

  const exclude = await vscode.window.showInputBox({
    prompt: "Exclude pattern (optional)",
    placeHolder: "*.test.ts, **/__mocks__/**",
  })
  if (exclude === undefined) return null

  const pattern = await vscode.window.showInputBox({
    prompt: "Regex filter (optional)",
    placeHolder: "e.g., auth|jwt",
  })
  if (pattern === undefined) return null

  const limitInput = await vscode.window.showInputBox({
    prompt: "Max results (optional)",
    placeHolder: "e.g., 20",
  })
  if (limitInput === undefined) return null

  const variant = await vscode.window.showInputBox({
    prompt: "Variant (optional)",
    placeHolder: "e.g., interface, dataclass, protocol, async",
  })
  if (variant === undefined) return null

  const decorator = await vscode.window.showInputBox({
    prompt: "Decorator (optional)",
    placeHolder: "e.g., @property, @dataclass",
  })
  if (decorator === undefined) return null

  const isAsyncPick = await vscode.window.showQuickPick(["", "Yes"], {
    placeHolder: "Async functions/methods only?",
  })
  if (isAsyncPick === undefined) return null

  const isStaticPick = await vscode.window.showQuickPick(["", "Yes"], {
    placeHolder: "Static methods only?",
  })
  if (isStaticPick === undefined) return null

  const isAbstractPick = await vscode.window.showQuickPick(["", "Yes"], {
    placeHolder: "Abstract classes/methods only?",
  })
  if (isAbstractPick === undefined) return null

  const rerankPick = await vscode.window.showQuickPick(["No", "Yes"], {
    placeHolder: "Enable reranking?",
  })
  if (!rerankPick) return null

  const options: SearchOptions = {}
  if (language) options.language = language as any
  if (symbol?.trim()) options.symbol = symbol.trim()
  if (parentScope?.trim()) options.parentScope = parentScope.trim()
  if (imports?.trim()) options.imports = imports.trim()
  if (include?.trim()) options.include = include.trim()
  if (exclude?.trim()) options.exclude = exclude.trim()
  if (pattern?.trim()) options.pattern = pattern.trim()
  if (minScoreInput?.trim()) {
    const value = parseFloat(minScoreInput)
    if (!Number.isNaN(value)) options.minScore = value
  }
  if (maxPerFileInput?.trim()) {
    const value = parseInt(maxPerFileInput, 10)
    if (!Number.isNaN(value)) options.maxPerFile = value
  }
  if (maxPerSymbolInput?.trim()) {
    const value = parseInt(maxPerSymbolInput, 10)
    if (!Number.isNaN(value)) options.maxPerSymbol = value
  }
  if (limitInput?.trim()) {
    const value = parseInt(limitInput, 10)
    if (!Number.isNaN(value)) options.limit = value
  }
  // Multilingual support fields
  if (variant?.trim()) options.variant = variant.trim()
  if (decorator?.trim()) options.decorator = decorator.trim()
  if (isAsyncPick === "Yes") options.isAsync = true
  if (isStaticPick === "Yes") options.isStatic = true
  if (isAbstractPick === "Yes") options.isAbstract = true
  options.rerank = rerankPick === "Yes"

  return { query, options }
}

async function applySemanticFolding(
  core: SensegrepCore,
  editor: vscode.TextEditor,
  result: SearchResult
) {
  const config = vscode.workspace.getConfiguration("sensegrep")
  const enabled = config.get<boolean>("semanticFolding")
  if (enabled === false) {
    try {
      await vscode.commands.executeCommand("editor.unfoldAll")
    } catch {
      // ignore
    }
    return
  }

  const regions = await core.getCollapsibleRegions(result.file, { fallbackToParse: true })
  if (!regions || regions.length === 0) return

  const relevant = { startLine: result.startLine, endLine: result.endLine }
  const foldLines = regions
    .filter(
      (region) =>
        region.endLine < relevant.startLine || region.startLine > relevant.endLine
    )
    .map((region) => Math.max(0, region.startLine - 1))

  if (foldLines.length === 0) return

  try {
    await vscode.commands.executeCommand("editor.unfoldAll")
    await vscode.commands.executeCommand("editor.fold", {
      selectionLines: foldLines,
    })
  } catch {
    // Ignore folding errors if the editor doesn't support it
  }
}

async function foldUnrelatedInEditor(
  core: SensegrepCore,
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document
  const selection = editor.selection

  let targetRange: vscode.Range | null = null
  if (!selection.isEmpty) {
    targetRange = new vscode.Range(selection.start, selection.end)
  } else {
    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    )) as vscode.DocumentSymbol[] | undefined
    if (symbols && symbols.length > 0) {
      targetRange = findBestSymbolRange(symbols, selection.active)
    }
  }

  if (!targetRange) {
    targetRange = new vscode.Range(selection.active, selection.active)
  }

  const regions = await core.getCollapsibleRegions(document.uri.fsPath, {
    fallbackToParse: true,
  })
  if (!regions || regions.length === 0) return

  const relevant = {
    startLine: targetRange.start.line + 1,
    endLine: targetRange.end.line + 1,
  }

  const foldLines = regions
    .filter(
      (region) =>
        region.endLine < relevant.startLine || region.startLine > relevant.endLine
    )
    .map((region) => Math.max(0, region.startLine - 1))

  if (foldLines.length === 0) return

  await vscode.commands.executeCommand("editor.unfold", {
    selectionLines: [Math.max(0, relevant.startLine - 1)],
  })
  await vscode.commands.executeCommand("editor.fold", {
    selectionLines: foldLines,
  })
}

function findBestSymbolRange(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position
): vscode.Range | null {
  let best: vscode.Range | null = null

  const visit = (symbol: vscode.DocumentSymbol) => {
    if (symbol.range.contains(position)) {
      if (!best || rangeSize(symbol.range) < rangeSize(best)) {
        best = symbol.range
      }
    }
    for (const child of symbol.children) {
      visit(child)
    }
  }

  for (const symbol of symbols) {
    visit(symbol)
  }

  return best
}

function rangeSize(range: vscode.Range): number {
  return (range.end.line - range.start.line) * 1000 + (range.end.character - range.start.character)
}

function resolveRecord(input: unknown): SearchRecord | null {
  if (!input) return null
  if (typeof input === "string") {
    return { id: "", query: input }
  }
  if (typeof input === "object" && input) {
    if ("query" in input && typeof (input as SearchRecord).query === "string") {
      return input as SearchRecord
    }
    if ("record" in input && (input as { record?: SearchRecord }).record) {
      return (input as { record?: SearchRecord }).record ?? null
    }
  }
  return null
}

async function pickDuplicateInstance(
  placeHolder: string,
  instances: DuplicateGroup["instances"]
): Promise<DuplicateGroup["instances"][number] | null> {
  const items = instances.map((inst) => ({
    label: `${path.basename(inst.file)}:${inst.startLine}`,
    description: inst.symbol || "anonymous",
    detail: inst.file,
    instance: inst,
  }))
  const picked = await vscode.window.showQuickPick(items, { placeHolder })
  return picked?.instance ?? null
}

function normalizeGoToResultPayload(
  payload: SearchResult | { result: SearchResult; query?: string }
): { result: SearchResult; query?: string } {
  if (payload && typeof payload === "object" && "result" in payload) {
    return { result: payload.result, query: payload.query }
  }
  return { result: payload as SearchResult }
}

function highlightResultContent(
  editor: vscode.TextEditor,
  range: vscode.Range,
  result: SearchResult
) {
  const content = result.content?.trim()
  if (!content) return

  const candidateLines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length >= 2)
    .slice(0, 20)

  if (candidateLines.length === 0) return

  const doc = editor.document
  const ranges: vscode.Range[] = []
  const maxRanges = 200

  for (let line = range.start.line; line <= range.end.line; line += 1) {
    const text = doc.lineAt(line).text
    for (const snippet of candidateLines) {
      let startIndex = 0
      while (startIndex >= 0) {
        const idx = text.indexOf(snippet, startIndex)
        if (idx === -1) break
        ranges.push(new vscode.Range(line, idx, line, idx + snippet.length))
        if (ranges.length >= maxRanges) break
        startIndex = idx + snippet.length
      }
      if (ranges.length >= maxRanges) break
    }
    if (ranges.length >= maxRanges) break
  }

  if (ranges.length === 0) return

  const decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
    borderRadius: "2px",
  })

  editor.setDecorations(decoration, ranges)

  setTimeout(() => {
    decoration.dispose()
  }, 2000)
}

async function unfoldAllVisibleEditors() {
  const editors = vscode.window.visibleTextEditors
  const active = vscode.window.activeTextEditor

  for (const editor of editors) {
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: true,
      preview: false,
    })
    await vscode.commands.executeCommand("editor.unfoldAll")
  }

  if (active) {
    await vscode.window.showTextDocument(active.document, {
      viewColumn: active.viewColumn,
      preserveFocus: true,
      preview: false,
    })
  }
}

async function getSnippetDocument(
  instance: DuplicateGroup["instances"][number],
  rootDir: string
): Promise<vscode.Uri> {
  const filePath = path.isAbsolute(instance.file)
    ? instance.file
    : path.join(rootDir, instance.file)
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))

  const start = Math.max(0, instance.startLine - 1)
  const end = Math.max(start, Math.min(doc.lineCount - 1, instance.endLine - 1))
  const endChar = doc.lineAt(end).text.length
  const range = new vscode.Range(start, 0, end, endChar)
  const content = doc.getText(range)
  const header = `// ${instance.file}:${instance.startLine}-${instance.endLine}\n`

  const snippetDoc = await vscode.workspace.openTextDocument({
    content: header + content,
    language: doc.languageId,
  })
  return snippetDoc.uri
}

async function openJsonDocument(title: string, payload: unknown) {
  const content = JSON.stringify(payload, null, 2)
  const doc = await vscode.workspace.openTextDocument({
    language: "jsonc",
    content: `// ${title}\n${content}`,
  })
  await vscode.window.showTextDocument(doc, { preview: false })
}

async function promptExportFormat(): Promise<"json" | "markdown" | null> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "JSON", value: "json" },
      { label: "Markdown", value: "markdown" },
    ],
    { placeHolder: "Choose export format" }
  )
  return (choice?.value as "json" | "markdown") ?? null
}

async function runIndexWithProgress(
  core: SensegrepCore,
  statusBar: StatusBarManager,
  full: boolean
) {
  let unsubscribe: (() => void) | null = null
  let lastCurrent = 0
  let total = 0

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: full ? "Sensegrep: Full indexing" : "Sensegrep: Indexing",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Starting..." })
      try {
        unsubscribe = await core.subscribeIndexProgress((event) => {
          if (event.phase === "scanning") {
            progress.report({ message: event.message ?? "Scanning files..." })
            return
          }
          if (event.phase === "indexing") {
            total = event.total || total
            const increment =
              total > 0 ? ((event.current - lastCurrent) / total) * 100 : 0
            lastCurrent = event.current
            const filename = event.file ? path.basename(event.file) : ""
            progress.report({
              message: `${event.current}/${event.total} ${filename}`.trim(),
              increment: increment > 0 ? increment : undefined,
            })
            return
          }
          if (event.phase === "complete") {
            progress.report({ message: event.message ?? "Complete", increment: 100 })
          }
          if (event.phase === "error") {
            statusBar.setError(event.message)
          }
        })
        return await core.indexProject(full)
      } finally {
        unsubscribe?.()
      }
    }
  )
}

function formatSearchMarkdown(payload: {
  query: string
  options?: SearchOptions | null
  summary?: {
    totalResults: number
    fileCount: number
    symbolCount: number
    indexed: boolean
    gaps: Array<{ folder: string; totalFiles: number; matchedFiles: number }>
  } | null
  results: SearchResult[]
  shakedFiles?: Array<{
    file: string
    content: string
    stats: { hiddenLines: number }
    matchCount: number
  }>
}): string {
  const lines: string[] = []
  lines.push("# Sensegrep Search Results")
  lines.push("")
  lines.push(`Query: ${payload.query}`)
  if (payload.options) {
    lines.push("")
    lines.push("## Options")
    lines.push("```json")
    lines.push(JSON.stringify(payload.options, null, 2))
    lines.push("```")
  }

  if (payload.summary) {
    lines.push("")
    lines.push("## Summary")
    lines.push(`- Results: ${payload.summary.totalResults}`)
    lines.push(`- Files: ${payload.summary.fileCount}`)
    lines.push(`- Symbols: ${payload.summary.symbolCount}`)
    if (payload.summary.gaps && payload.summary.gaps.length > 0) {
      lines.push("")
      lines.push("### Top lacunas reais")
      for (const gap of payload.summary.gaps) {
        lines.push(
          `- ${gap.folder}: ${gap.matchedFiles}/${gap.totalFiles} arquivos`
        )
      }
    }
  }

  lines.push("")
  lines.push("## Results")
  payload.results.forEach((result, idx) => {
    lines.push("")
    lines.push(
      `### ${idx + 1}. ${result.file}:${result.startLine}-${result.endLine}`
    )
    const meta: string[] = []
    meta.push(`Relevance: ${(result.relevance * 100).toFixed(1)}%`)
    if (typeof result.rerankScore === "number") {
      meta.push(`Rerank: ${result.rerankScore.toFixed(3)}`)
    }
    if (result.symbolType || result.symbolName) {
      meta.push(
        `Symbol: ${[result.symbolType, result.symbolName].filter(Boolean).join(" ")}`
      )
    }
    if (result.parentScope) meta.push(`Parent: ${result.parentScope}`)
    if (typeof result.complexity === "number") {
      meta.push(`Complexity: ${result.complexity}`)
    }
    if (result.isExported) meta.push("Exported: true")
    if (meta.length > 0) {
      lines.push(meta.join(" | "))
    }
    lines.push("```ts")
    lines.push(result.content)
    lines.push("```")
  })

  if (payload.shakedFiles && payload.shakedFiles.length > 0) {
    lines.push("")
    lines.push("## Tree-shaken Output")
    for (const entry of payload.shakedFiles) {
      lines.push("")
      lines.push(`### ${entry.file} (${entry.matchCount} match(es))`)
      lines.push(`Hidden lines: ${entry.stats.hiddenLines}`)
      lines.push("```ts")
      lines.push(entry.content)
      lines.push("```")
    }
  }

  return lines.join("\n")
}

function formatDuplicateMarkdown(payload: {
  summary: { totalDuplicates: number; byLevel: Record<string, number>; totalSavings: number; filesAffected: number }
  duplicates: DuplicateGroup[]
  acceptableDuplicates?: DuplicateGroup[]
  display?: { limit?: number; showCode?: boolean; fullCode?: boolean }
}): string {
  const lines: string[] = []
  lines.push("# Sensegrep Duplicate Results")
  lines.push("")
  lines.push("## Summary")
  lines.push(`- Total duplicates: ${payload.summary.totalDuplicates}`)
  lines.push(`- Files affected: ${payload.summary.filesAffected}`)
  lines.push(`- Lines savable: ~${payload.summary.totalSavings}`)
  lines.push("")
  lines.push(
    `Levels: exact=${payload.summary.byLevel.exact ?? 0}, high=${payload.summary.byLevel.high ?? 0}, medium=${payload.summary.byLevel.medium ?? 0}, low=${payload.summary.byLevel.low ?? 0}`
  )

  const wantsFull = payload.display?.fullCode ?? false
  const wantsCode = (payload.display?.showCode ?? false) || wantsFull

  const renderGroup = (group: DuplicateGroup, idx: number, title: string) => {
    lines.push("")
    lines.push(`### ${title} #${idx + 1}`)
    lines.push(
      `Similarity: ${(group.similarity * 100).toFixed(1)}% | Level: ${group.level}`
    )
    lines.push(
      `Impact score: ${group.impact.score.toFixed(0)} | Savings: ~${group.impact.estimatedSavings}`
    )
    if (group.category) lines.push(`Category: ${group.category}`)
    if (group.isLikelyOk) lines.push(`Likely OK: true`)
    lines.push("")
    lines.push("Instances:")
    group.instances.forEach((inst, iIdx) => {
      lines.push(
        `- ${inst.file}:${inst.startLine}-${inst.endLine} (${inst.symbol || "anonymous"})`
      )
      if (wantsCode) {
        const codeLines = inst.content.split("\n")
        const maxLines = wantsFull ? codeLines.length : 15
        const displayLines = codeLines.slice(0, maxLines)
        lines.push("```ts")
        lines.push(displayLines.join("\n"))
        if (codeLines.length > maxLines) {
          lines.push(`// ... (${codeLines.length - maxLines} more lines)`)
        }
        lines.push("```")
      }
    })
  }

  lines.push("")
  lines.push("## Duplicate Groups")
  payload.duplicates.forEach((group, idx) =>
    renderGroup(group, idx, "Duplicate")
  )

  if (payload.acceptableDuplicates && payload.acceptableDuplicates.length > 0) {
    lines.push("")
    lines.push("## Acceptable Duplicates")
    payload.acceptableDuplicates.forEach((group, idx) =>
      renderGroup(group, idx, "Acceptable")
    )
  }

  return lines.join("\n")
}
