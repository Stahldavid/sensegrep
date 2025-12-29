import * as vscode from "vscode"
import { SearchResult } from "../core"
import * as path from "path"

export class ResultsTreeProvider implements vscode.TreeDataProvider<ResultItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ResultItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private results: SearchResult[] = []
  private query: string = ""

  setResults(results: SearchResult[], query: string) {
    this.results = results
    this.query = query
    this._onDidChangeTreeData.fire(undefined)
  }

  clear() {
    this.results = []
    this.query = ""
    this._onDidChangeTreeData.fire(undefined)
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: ResultItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: ResultItem): Thenable<ResultItem[]> {
    if (!element) {
      // Root level: show results grouped by file
      const byFile = new Map<string, SearchResult[]>()
      for (const result of this.results) {
        const list = byFile.get(result.file) ?? []
        list.push(result)
        byFile.set(result.file, list)
      }

      const items: ResultItem[] = []
      for (const [file, results] of byFile) {
        items.push(new ResultItem(file, results, this.query))
      }
      return Promise.resolve(items)
    }

    // File level: show individual results
    if (element.results) {
      return Promise.resolve(
        element.results.map((r) => new ResultItem(r.symbolName ?? "match", [r], this.query, true))
      )
    }

    return Promise.resolve([])
  }
}

class ResultItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly results: SearchResult[],
    public readonly query: string,
    public readonly isLeaf: boolean = false
  ) {
    super(
      label,
      isLeaf ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded
    )

    if (isLeaf && results.length > 0) {
      const result = results[0]
      this.description = `${result.symbolType ?? ""} • ${(result.relevance * 100).toFixed(0)}%`
      const tooltip = new vscode.MarkdownString()
      tooltip.appendMarkdown(`**Relevance:** ${(result.relevance * 100).toFixed(1)}%\n\n`)
      if (typeof result.rerankScore === "number") {
        tooltip.appendMarkdown(`**Rerank:** ${result.rerankScore.toFixed(3)}\n\n`)
      }
      if (result.symbolName || result.symbolType) {
        tooltip.appendMarkdown(
          `**Symbol:** ${[result.symbolType, result.symbolName].filter(Boolean).join(" ")}\n\n`
        )
      }
      if (result.parentScope) {
        tooltip.appendMarkdown(`**Parent:** ${result.parentScope}\n\n`)
      }
      if (typeof result.complexity === "number") {
        tooltip.appendMarkdown(`**Complexity:** ${result.complexity}\n\n`)
      }
      if (result.isExported) {
        tooltip.appendMarkdown(`**Exported:** true\n\n`)
      }
      tooltip.appendCodeblock(formatPreview(result.content), "typescript")
      this.tooltip = tooltip

      this.iconPath = this.getIconForType(result.symbolType)
      this.command = {
        command: "sensegrep.goToResult",
        title: "Go to Result",
        arguments: [{ result, query: this.query }],
      }
    } else {
      // File node
      this.description = `${results.length} match${results.length > 1 ? "es" : ""}`
      this.iconPath = vscode.ThemeIcon.File
      this.resourceUri = vscode.Uri.file(results[0]?.file ?? "")
    }
  }

  private getIconForType(type?: string): vscode.ThemeIcon {
    switch (type) {
      case "function":
        return new vscode.ThemeIcon("symbol-function")
      case "method":
        return new vscode.ThemeIcon("symbol-method")
      case "class":
        return new vscode.ThemeIcon("symbol-class")
      case "interface":
        return new vscode.ThemeIcon("symbol-interface")
      case "type":
        return new vscode.ThemeIcon("symbol-type-parameter")
      case "variable":
        return new vscode.ThemeIcon("symbol-variable")
      default:
        return new vscode.ThemeIcon("symbol-misc")
    }
  }
}

function formatPreview(content: string, maxLines: number = 12, maxChars: number = 500): string {
  if (!content) return ""
  const lines = content.split(/\r?\n/)
  if (lines.length === 0) return ""

  let previewLines = lines
  if (lines.length > maxLines) {
    const half = Math.floor(maxLines / 2)
    const center = Math.floor(lines.length / 2)
    const start = Math.max(0, center - half)
    const end = Math.min(lines.length, start + maxLines)
    previewLines = lines.slice(start, end)
    if (start > 0) previewLines.unshift("…")
    if (end < lines.length) previewLines.push("…")
  }

  let preview = previewLines.join("\n")
  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars) + "…"
  }
  return preview
}


