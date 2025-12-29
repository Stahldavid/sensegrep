import * as vscode from "vscode"
import { DuplicateGroup } from "../core"
import * as path from "path"

export class DuplicatesTreeProvider implements vscode.TreeDataProvider<DuplicateItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DuplicateItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private duplicates: DuplicateGroup[] = []
  private summary: { totalDuplicates: number; totalSavings: number; filesAffected: number } | null = null

  setDuplicates(
    duplicates: DuplicateGroup[],
    summary: { totalDuplicates: number; totalSavings: number; filesAffected: number }
  ) {
    this.duplicates = duplicates
    this.summary = summary
    this._onDidChangeTreeData.fire(undefined)
  }

  clear() {
    this.duplicates = []
    this.summary = null
    this._onDidChangeTreeData.fire(undefined)
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: DuplicateItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: DuplicateItem): Thenable<DuplicateItem[]> {
    if (!element) {
      // Root level: show duplicate groups
      if (this.duplicates.length === 0) {
        return Promise.resolve([])
      }

      const items: DuplicateItem[] = []

      // Add summary item
      if (this.summary) {
        items.push(
          new DuplicateItem(
            `📊 ${this.summary.totalDuplicates} duplicates (${this.summary.totalSavings} lines savable)`,
            undefined,
            "summary"
          )
        )
      }

      // Add each duplicate group
      this.duplicates.forEach((dup, index) => {
        items.push(new DuplicateItem(`#${index + 1}`, dup, "group", index))
      })

      return Promise.resolve(items)
    }

    // Group level: show instances
    if (element.group) {
      return Promise.resolve(
        element.group.instances.map(
          (inst, idx) =>
            new DuplicateItem(path.basename(inst.file), element.group!, "instance", idx, inst)
        )
      )
    }

    return Promise.resolve([])
  }
}

class DuplicateItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly group: DuplicateGroup | undefined,
    public readonly type: "summary" | "group" | "instance",
    public readonly index: number = 0,
    public readonly instance?: DuplicateGroup["instances"][0]
  ) {
    super(
      label,
      type === "group"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    )

    if (type === "summary") {
      this.iconPath = new vscode.ThemeIcon("graph")
      this.contextValue = "summary"
    } else if (type === "group" && group) {
      const emoji = this.getEmoji(group.level)
      const pct = (group.similarity * 100).toFixed(0)
      this.label = `${emoji} #${index + 1} - ${pct}% similar`
      this.description = `${group.instances.length} instances • ${group.impact.estimatedSavings} lines`
      this.iconPath = this.getIconForLevel(group.level)
      this.tooltip = new vscode.MarkdownString()
      this.tooltip.appendMarkdown(`**${group.level.toUpperCase()}** - ${pct}% similar\n\n`)
      this.tooltip.appendMarkdown(`- Impact score: ${group.impact.score.toFixed(0)}\n`)
      this.tooltip.appendMarkdown(`- Total lines: ${group.impact.totalLines}\n`)
      this.tooltip.appendMarkdown(`- Complexity: ${group.impact.complexity.toFixed(1)}\n`)
      this.tooltip.appendMarkdown(`- Savings: ~${group.impact.estimatedSavings} lines\n`)
      this.contextValue = "duplicateGroup"
    } else if (type === "instance" && instance) {
      this.description = `${instance.symbol} (${instance.startLine}-${instance.endLine})`
      this.iconPath = new vscode.ThemeIcon("file-code")
      this.tooltip = new vscode.MarkdownString()
      this.tooltip.appendCodeblock(instance.content.substring(0, 500), "typescript")
      this.command = {
        command: "sensegrep.goToDuplicate",
        title: "Go to Location",
        arguments: [instance.file, instance.startLine, instance.endLine],
      }
      this.contextValue = "duplicateInstance"
    }
  }

  private getEmoji(level: string): string {
    switch (level) {
      case "exact":
        return "🔥"
      case "high":
        return "⚠️"
      case "medium":
        return "ℹ️"
      case "low":
        return "💡"
      default:
        return "📋"
    }
  }

  private getIconForLevel(level: string): vscode.ThemeIcon {
    switch (level) {
      case "exact":
        return new vscode.ThemeIcon("flame", new vscode.ThemeColor("errorForeground"))
      case "high":
        return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"))
      case "medium":
        return new vscode.ThemeIcon("info", new vscode.ThemeColor("editorInfo.foreground"))
      default:
        return new vscode.ThemeIcon("lightbulb")
    }
  }
}
