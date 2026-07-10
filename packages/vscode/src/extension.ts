import * as vscode from "vscode"
import { SearchViewProvider } from "./views/search-view"
import { ResultsTreeProvider } from "./providers/results-tree"
import { DuplicatesViewProvider } from "./views/duplicates-view"
import { HistoryTreeProvider } from "./providers/history-tree"
import { SensegrepCodeLensProvider } from "./providers/codelens"
import { StatusBarManager } from "./providers/statusbar"
import { DuplicateDiagnosticsManager } from "./providers/duplicate-diagnostics"
import { SensegrepOutput } from "./providers/log"
import { SensegrepCore } from "./core"
import { registerCommands } from "./commands"

let core: SensegrepCore | undefined

const workspaceCommandIds = [
  "sensegrep.search",
  "sensegrep.searchAdvanced",
  "sensegrep.survey",
  "sensegrep.cluster",
  "sensegrep.searchSelection",
  "sensegrep.saveSearch",
  "sensegrep.detectDuplicates",
  "sensegrep.indexProject",
  "sensegrep.reindexProject",
  "sensegrep.showStats",
  "sensegrep.verifyIndex",
  "sensegrep.showStatusJson",
  "sensegrep.toggleWatch",
  "sensegrep.openSettings",
  "sensegrep.foldUnrelated",
  "sensegrep.toggleSemanticFolding",
  "sensegrep.setIndexRoot",
  "sensegrep.setApiKey",
  "sensegrep.refreshResults",
  "sensegrep.clearResults",
  "sensegrep.goToResult",
  "sensegrep.openResultToSide",
  "sensegrep.copyResultLocation",
  "sensegrep.exportSearchResults",
  "sensegrep.exportDuplicateResults",
  "sensegrep.editSavedSearchTags",
  "sensegrep.removeSavedSearch",
]

export async function activate(context: vscode.ExtensionContext) {
  const output = new SensegrepOutput()
  context.subscriptions.push(output)
  output.info("Sensegrep extension activating...")

  // Initialize core
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
    registerNoWorkspaceViews(context)
    registerNoWorkspaceCommands(context, output)
    vscode.window.showWarningMessage("Sensegrep: No workspace folder open")
    output.warn("Activation stopped: no workspace folder open")
    return
  }

  core = new SensegrepCore(context, workspaceRoot)
  const coreInstance = core

  // Initialize providers
  const resultsProvider = new ResultsTreeProvider()
  const duplicateDiagnostics = new DuplicateDiagnosticsManager(coreInstance)
  const duplicatesViewProvider = new DuplicatesViewProvider(
    context.extensionUri,
    coreInstance,
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
  const searchViewProvider = new SearchViewProvider(context.extensionUri, coreInstance, resultsProvider, historyProvider)
  const searchView = vscode.window.registerWebviewViewProvider("sensegrep.search", searchViewProvider)

  // Register CodeLens provider
  const codeLensProvider = new SensegrepCodeLensProvider(coreInstance)
  const codeLens = vscode.languages.registerCodeLensProvider(
    [
      { language: "typescript", scheme: "file" },
      { language: "typescriptreact", scheme: "file" },
      { language: "javascript", scheme: "file" },
      { language: "javascriptreact", scheme: "file" },
      { language: "python", scheme: "file" },
      { language: "java", scheme: "file" },
      { language: "vue", scheme: "file" },
    ],
    codeLensProvider
  )

  // Register commands
  const commands = registerCommands(
    context,
    coreInstance,
    resultsProvider,
    searchViewProvider,
    duplicatesViewProvider,
    duplicateDiagnostics,
    historyProvider,
    statusBar,
    output
  )

  // Auto-index on startup if enabled
  const config = vscode.workspace.getConfiguration("sensegrep")
  // Update status bar
  statusBar.setReady()
  statusBar.updateFoldingState(config.get<boolean>("semanticFolding") ?? true)
  if (config.get("autoIndex")) {
    statusBar.setIndexing()
    coreInstance
      .indexAllProjects(false)
      .then((results) => {
        const files = results.reduce((total, result) => total + result.files, 0)
        const chunks = results.reduce((total, result) => total + result.chunks, 0)
        statusBar.setIndexed(chunks)
        output.info(`Indexed ${files} files (${chunks} chunks) across ${results.length} workspace folders`)
        if (chunks > 0) {
          vscode.window.showInformationMessage(`Sensegrep: Indexed ${files} files (${chunks} chunks) across ${results.length} folders`)
        }
      })
      .catch((err) => {
        statusBar.setError(String(err))
        output.error("Sensegrep auto-index failed", err)
      })
  }

  const updateWatcher = async (enabled: boolean) => {
    if (!enabled) {
      await coreInstance.stopIndexWatcher()
      return
    }
    try {
      await coreInstance.reloadSettings()
      const interval =
        vscode.workspace.getConfiguration("sensegrep").get<number>("watchIntervalMs") ||
        60000
      await coreInstance.startIndexWatcher({
        intervalMs: interval,
        onIndex: (result) => {
          statusBar.setIndexed(result.chunks)
          output.info(`Watcher indexed ${result.files} files (${result.chunks} chunks)`)
        },
        onError: (err) => {
          const message = String(err)
          statusBar.setError(message)
          output.error("Sensegrep watcher error", err)
          if (message.includes("Watcher paused after")) {
            void vscode.window
              .showErrorMessage(`Sensegrep watcher error: ${message}`, "Open Settings", "Reindex")
              .then((choice) => {
                if (choice === "Open Settings") {
                  void vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "sensegrep.embeddings",
                  )
                } else if (choice === "Reindex") {
                  void vscode.commands.executeCommand("sensegrep.indexProject")
                }
              })
          } else {
            output.warn(`Sensegrep watcher warning: ${message}`)
          }
        },
      })
    } catch (err) {
      output.error("Sensegrep watcher failed", err)
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
        if (enabled === false) {
          void vscode.commands.executeCommand("sensegrep.unfoldAllEditors")
        }
      }

      if (event.affectsConfiguration("sensegrep.logLevel")) {
        void coreInstance.reloadSettings()
      }

      if (
        event.affectsConfiguration("sensegrep.embeddings.provider") ||
        event.affectsConfiguration("sensegrep.embeddings.model") ||
        event.affectsConfiguration("sensegrep.embeddings.dimension") ||
        event.affectsConfiguration("sensegrep.embeddings.baseUrl") ||
        event.affectsConfiguration("sensegrep.embeddings.region") ||
        event.affectsConfiguration("sensegrep.embeddings.apiKey") ||
        event.affectsConfiguration("sensegrep.geminiApiKey")
      ) {
        void coreInstance.reloadSettings()
        void searchViewProvider.refreshApiKeyBanner()
        const watchEnabled = vscode.workspace
          .getConfiguration("sensegrep")
          .get<boolean>("watchMode")
        if (watchEnabled) {
          void updateWatcher(true)
        }
      }

      if (
        event.affectsConfiguration("sensegrep.watchMode") ||
        event.affectsConfiguration("sensegrep.watchIntervalMs") ||
        event.affectsConfiguration("sensegrep.includeDocs") ||
        event.affectsConfiguration("sensegrep.includeConfig")
      ) {
        const enabled = vscode.workspace
          .getConfiguration("sensegrep")
          .get<boolean>("watchMode")
        void updateWatcher(enabled ?? false)
      }
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const enabled = vscode.workspace.getConfiguration("sensegrep").get<boolean>("watchMode") ?? false
      void updateWatcher(enabled)
    })
  )

  output.info("Sensegrep extension activated")
}

export function deactivate() {
  core?.dispose()
}

export function getCore(): SensegrepCore | undefined {
  return core
}

function registerNoWorkspaceCommands(
  context: vscode.ExtensionContext,
  output: SensegrepOutput
) {
  const showWorkspaceRequired = async () => {
    output.warn("Command requires an open workspace folder")
    const choice = await vscode.window.showWarningMessage(
      "Sensegrep needs an open folder or workspace before it can search, index, or refresh results.",
      "Open Folder"
    )
    if (choice === "Open Folder") {
      await vscode.commands.executeCommand("workbench.action.files.openFolder")
    }
  }

  for (const commandId of workspaceCommandIds) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, async () => {
        if (commandId === "sensegrep.openSettings") {
          await vscode.commands.executeCommand("workbench.action.openSettings", "sensegrep")
          return
        }
        await showWorkspaceRequired()
      })
    )
  }
}

function registerNoWorkspaceViews(context: vscode.ExtensionContext) {
  const emptyTree = new NoWorkspaceTreeProvider()

  context.subscriptions.push(
    vscode.window.createTreeView("sensegrep.results", {
      treeDataProvider: emptyTree,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView("sensegrep.history", {
      treeDataProvider: emptyTree,
      showCollapseAll: false,
    }),
    vscode.window.registerWebviewViewProvider(
      "sensegrep.search",
      new NoWorkspaceWebviewProvider("Search")
    ),
    vscode.window.registerWebviewViewProvider(
      "sensegrep.duplicates",
      new NoWorkspaceWebviewProvider("Duplicates")
    )
  )
}

class NoWorkspaceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): Thenable<vscode.TreeItem[]> {
    const item = new vscode.TreeItem(
      "Open a folder to use Sensegrep",
      vscode.TreeItemCollapsibleState.None
    )
    item.iconPath = new vscode.ThemeIcon("folder-opened")
    item.command = {
      command: "workbench.action.files.openFolder",
      title: "Open Folder",
    }
    return Promise.resolve([item])
  }
}

class NoWorkspaceWebviewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly title: string) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      padding: 16px;
    }
    button {
      background: var(--vscode-button-background);
      border: 0;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      padding: 8px 12px;
      width: 100%;
    }
    p {
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <h3>Sensegrep ${this.title}</h3>
  <p>Open a folder or workspace to index and search code.</p>
  <button id="openFolder">Open Folder</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("openFolder").addEventListener("click", () => {
      vscode.postMessage({ type: "openFolder" });
    });
  </script>
</body>
</html>`
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "openFolder") {
        await vscode.commands.executeCommand("workbench.action.files.openFolder")
      }
    })
  }
}
