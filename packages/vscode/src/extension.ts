import * as vscode from "vscode"
import { SearchViewProvider } from "./views/search-view"
import { ResultsTreeProvider } from "./providers/results-tree"
import { DuplicatesViewProvider } from "./views/duplicates-view"
import { HistoryTreeProvider } from "./providers/history-tree"
import { SensegrepCodeLensProvider } from "./providers/codelens"
import { StatusBarManager } from "./providers/statusbar"
import { DuplicateDiagnosticsManager } from "./providers/duplicate-diagnostics"
import { SensegrepCore } from "./core"
import { registerCommands } from "./commands"

let core: SensegrepCore | undefined

export async function activate(context: vscode.ExtensionContext) {
  console.log("Sensegrep extension activating...")

  // Initialize core
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Sensegrep: No workspace folder open")
    return
  }

  core = new SensegrepCore(context, workspaceRoot)

  // Initialize providers
  const resultsProvider = new ResultsTreeProvider()
  const duplicateDiagnostics = new DuplicateDiagnosticsManager(core)
  const duplicatesViewProvider = new DuplicatesViewProvider(
    context.extensionUri,
    core,
    duplicateDiagnostics
  )
  const historyProvider = new HistoryTreeProvider(context)
  const statusBar = new StatusBarManager()

  // Register tree views
  const resultsView = vscode.window.createTreeView("sensegrep.results", {
    treeDataProvider: resultsProvider,
    showCollapseAll: true,
  })

  const duplicatesView = vscode.window.registerWebviewViewProvider(
    DuplicatesViewProvider.viewType,
    duplicatesViewProvider
  )

  const historyView = vscode.window.createTreeView("sensegrep.history", {
    treeDataProvider: historyProvider,
  })

  // Register search webview
  const searchViewProvider = new SearchViewProvider(context.extensionUri, core, resultsProvider, historyProvider)
  const searchView = vscode.window.registerWebviewViewProvider("sensegrep.search", searchViewProvider)

  // Register CodeLens provider
  const codeLensProvider = new SensegrepCodeLensProvider(core)
  const codeLens = vscode.languages.registerCodeLensProvider(
    [
      { language: "typescript", scheme: "file" },
      { language: "typescriptreact", scheme: "file" },
      { language: "javascript", scheme: "file" },
      { language: "javascriptreact", scheme: "file" },
    ],
    codeLensProvider
  )

  // Register commands
  const commands = registerCommands(
    context,
    core,
    resultsProvider,
    searchViewProvider,
    duplicatesViewProvider,
    duplicateDiagnostics,
    historyProvider,
    statusBar
  )

  // Auto-index on startup if enabled
  const config = vscode.workspace.getConfiguration("sensegrep")
  // Update status bar
  statusBar.setReady()
  statusBar.updateFoldingState(config.get<boolean>("semanticFolding") ?? true)
  if (config.get("autoIndex")) {
    statusBar.setIndexing()
    core
      .indexProject(false)
      .then((result) => {
        statusBar.setIndexed(result.chunks)
        if (result.chunks > 0) {
          vscode.window.showInformationMessage(`Sensegrep: Indexed ${result.files} files (${result.chunks} chunks)`)
        }
      })
      .catch((err) => {
        statusBar.setError()
        console.error("Sensegrep auto-index failed:", err)
      })
  }

  const updateWatcher = async (enabled: boolean) => {
    if (!enabled) {
      await core.stopIndexWatcher()
      return
    }
    try {
      const interval =
        vscode.workspace.getConfiguration("sensegrep").get<number>("watchIntervalMs") ||
        60000
      await core.startIndexWatcher({
        intervalMs: interval,
        onIndex: (result) => {
          statusBar.setIndexed(result.chunks)
        },
        onError: (err) => {
          statusBar.setError()
          vscode.window.showErrorMessage(`Sensegrep watcher error: ${err}`)
        },
      })
    } catch (err) {
      vscode.window.showErrorMessage(`Sensegrep watcher failed: ${err}`)
    }
  }

  // Watch for file changes if enabled (core IndexWatcher)
  if (config.get("watchMode")) {
    void updateWatcher(true)
  }

  // Add all disposables
  context.subscriptions.push(
    resultsView,
    duplicatesView,
    historyView,
    searchView,
    codeLens,
    duplicateDiagnostics,
    statusBar,
    ...commands
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("sensegrep.showDiagnostics")) {
        const enabled = vscode.workspace
          .getConfiguration("sensegrep")
          .get<boolean>("showDiagnostics")
        if (!enabled) {
          duplicateDiagnostics.clear()
        }
      }

      if (event.affectsConfiguration("sensegrep.semanticFolding")) {
        const enabled = vscode.workspace
          .getConfiguration("sensegrep")
          .get<boolean>("semanticFolding")
        statusBar.updateFoldingState(enabled ?? true)
      }

      if (event.affectsConfiguration("sensegrep.logLevel")) {
        void core.reloadSettings()
      }

      if (
        event.affectsConfiguration("sensegrep.watchMode") ||
        event.affectsConfiguration("sensegrep.watchIntervalMs")
      ) {
        const enabled = vscode.workspace
          .getConfiguration("sensegrep")
          .get<boolean>("watchMode")
        void updateWatcher(enabled ?? false)
      }
    })
  )

  console.log("Sensegrep extension activated!")
}

export function deactivate() {
  core?.dispose()
  console.log("Sensegrep extension deactivated")
}

export function getCore(): SensegrepCore | undefined {
  return core
}
