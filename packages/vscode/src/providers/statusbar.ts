import * as vscode from "vscode"

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem
  private duplicatesItem: vscode.StatusBarItem
  private foldingItem: vscode.StatusBarItem
  private lastError: string | null = null

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.statusBarItem.command = "sensegrep.showStats"
    this.statusBarItem.show()

    this.duplicatesItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
    this.duplicatesItem.command = "sensegrep.detectDuplicates"

    this.foldingItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98)
    this.foldingItem.command = "sensegrep.toggleSemanticFolding"
    this.foldingItem.show()
  }

  setReady() {
    this.statusBarItem.text = "$(search) Sensegrep"
    this.statusBarItem.tooltip = "Click to show index stats"
    this.statusBarItem.backgroundColor = undefined
    this.lastError = null
  }

  setIndexing() {
    this.statusBarItem.text = "$(sync~spin) Indexing..."
    this.statusBarItem.tooltip = "Sensegrep is indexing your project"
    this.statusBarItem.backgroundColor = undefined
    this.lastError = null
  }

  setSearching() {
    this.statusBarItem.text = "$(sync~spin) Searching..."
    this.statusBarItem.tooltip = "Sensegrep is searching"
    this.statusBarItem.backgroundColor = undefined
    this.lastError = null
  }

  setAnalyzing() {
    this.statusBarItem.text = "$(sync~spin) Analyzing..."
    this.statusBarItem.tooltip = "Sensegrep is detecting duplicates"
    this.statusBarItem.backgroundColor = undefined
    this.lastError = null
  }

  setIndexed(chunks: number) {
    this.statusBarItem.text = `$(database) Indexed (${this.formatNumber(chunks)})`
    this.statusBarItem.tooltip = `Sensegrep: ${chunks} chunks indexed. Click for stats.`
    this.statusBarItem.backgroundColor = undefined
    this.lastError = null
  }

  setNotIndexed() {
    this.statusBarItem.text = "$(warning) Not indexed"
    this.statusBarItem.tooltip = "Click to index project"
    this.statusBarItem.command = "sensegrep.indexProject"
    this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
    this.lastError = null
  }

  setError(message?: string) {
    if (message) {
      this.lastError = message
    }
    this.statusBarItem.text = "$(error) Sensegrep"
    this.statusBarItem.tooltip = message ? `Error: ${message}` : "An error occurred. Click for details."
    this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
  }

  getLastError(): string | null {
    return this.lastError
  }

  setDuplicatesCount(count: number) {
    if (count === 0) {
      this.duplicatesItem.hide()
      return
    }

    this.duplicatesItem.text = `$(copy) ${count} duplicates`
    this.duplicatesItem.tooltip = `${count} duplicate code groups found. Click to view.`
    this.duplicatesItem.backgroundColor =
      count > 5
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined
    this.duplicatesItem.show()
  }

  updateFoldingState(enabled: boolean) {
    this.foldingItem.text = enabled ? "$(fold) Fold: On" : "$(unfold) Fold: Off"
    this.foldingItem.tooltip = enabled
      ? "Semantic folding enabled (click to disable)"
      : "Semantic folding disabled (click to enable)"
    this.foldingItem.backgroundColor = undefined
  }

  private formatNumber(n: number): string {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}k`
    }
    return String(n)
  }

  dispose() {
    this.statusBarItem.dispose()
    this.duplicatesItem.dispose()
    this.foldingItem.dispose()
  }
}
