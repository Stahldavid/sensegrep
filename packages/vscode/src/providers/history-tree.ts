import * as vscode from "vscode"
import type { SearchOptions } from "../core"

const MAX_HISTORY = 20
const HISTORY_KEY = "sensegrep.searchHistory"
const SAVED_KEY = "sensegrep.savedSearches"

export interface SearchRecord {
  id: string
  query: string
  options?: SearchOptions
  tags?: string[]
}

type HistoryNode = HistoryGroup | RecentSearchItem | SavedSearchItem

export class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HistoryNode | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private recent: SearchRecord[] = []
  private saved: SearchRecord[] = []
  private lastSearch: SearchRecord | null = null

  constructor(private context: vscode.ExtensionContext) {
    this.recent = this.loadRecords(HISTORY_KEY)
    this.saved = this.loadRecords(SAVED_KEY)
  }

  addSearch(query: string, options?: SearchOptions) {
    const record: SearchRecord = {
      id: this.createId(),
      query,
      options,
    }
    this.lastSearch = record

    const existingIndex = this.recent.findIndex((r) => r.query === query)
    if (existingIndex > -1) {
      this.recent.splice(existingIndex, 1)
    }

    this.recent.unshift(record)
    if (this.recent.length > MAX_HISTORY) {
      this.recent = this.recent.slice(0, MAX_HISTORY)
    }

    this.persist()
    this._onDidChangeTreeData.fire(undefined)
  }

  getLastSearch(): SearchRecord | null {
    return this.lastSearch
  }

  saveSearch(input?: Partial<SearchRecord>) {
    const record = input?.query ? this.normalizeRecord(input) : this.lastSearch
    if (!record) return

    const existingIndex = this.saved.findIndex((r) => r.query === record.query)
    if (existingIndex > -1) {
      const existing = this.saved[existingIndex]
      this.saved[existingIndex] = {
        ...existing,
        options: record.options ?? existing.options,
        tags: record.tags ?? existing.tags,
      }
    } else {
      this.saved.unshift({
        ...record,
        id: record.id || this.createId(),
      })
    }

    this.persist()
    this._onDidChangeTreeData.fire(undefined)
  }

  updateSavedTags(id: string, tags: string[]) {
    const index = this.saved.findIndex((r) => r.id === id)
    if (index === -1) return
    this.saved[index] = { ...this.saved[index], tags }
    this.persist()
    this._onDidChangeTreeData.fire(undefined)
  }

  removeSaved(id: string) {
    this.saved = this.saved.filter((r) => r.id !== id)
    this.persist()
    this._onDidChangeTreeData.fire(undefined)
  }

  clear() {
    this.recent = []
    this.persist()
    this._onDidChangeTreeData.fire(undefined)
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: HistoryNode): vscode.TreeItem {
    return element
  }

  getChildren(element?: HistoryNode): Thenable<HistoryNode[]> {
    if (!element) {
      return Promise.resolve([
        new HistoryGroup("Saved Searches", "saved"),
        new HistoryGroup("Recent Searches", "recent"),
      ])
    }

    if (element instanceof HistoryGroup) {
      if (element.group === "saved") {
        return Promise.resolve(this.saved.map((record) => new SavedSearchItem(record)))
      }
      return Promise.resolve(this.recent.map((record) => new RecentSearchItem(record)))
    }

    return Promise.resolve([])
  }

  private persist() {
    this.context.globalState.update(HISTORY_KEY, this.recent)
    this.context.globalState.update(SAVED_KEY, this.saved)
  }

  private loadRecords(key: string): SearchRecord[] {
    const stored = this.context.globalState.get<SearchRecord[] | string[]>(key)
    if (!stored) return []
    if (Array.isArray(stored) && typeof stored[0] === "string") {
      return (stored as string[]).map((query) => ({
        id: this.createId(),
        query,
      }))
    }
    return (stored as SearchRecord[]).map((record) => this.normalizeRecord(record))
  }

  private normalizeRecord(record: Partial<SearchRecord>): SearchRecord {
    return {
      id: record.id ?? this.createId(),
      query: record.query ?? "",
      options: record.options,
      tags: record.tags ?? [],
    }
  }

  private createId(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

class HistoryGroup extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly group: "saved" | "recent"
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded)
    this.contextValue = "historyGroup"
    this.iconPath = new vscode.ThemeIcon(group === "saved" ? "star-full" : "history")
  }
}

class SavedSearchItem extends vscode.TreeItem {
  constructor(public readonly record: SearchRecord) {
    super(record.query, vscode.TreeItemCollapsibleState.None)

    this.description = record.tags && record.tags.length > 0 ? record.tags.join(", ") : ""
    this.iconPath = new vscode.ThemeIcon("star-full")
    this.tooltip = `Saved search: ${record.query}`
    this.command = {
      command: "sensegrep.executeSearch",
      title: "Execute Search",
      arguments: [record],
    }
    this.contextValue = "savedSearchItem"
  }
}

class RecentSearchItem extends vscode.TreeItem {
  constructor(public readonly record: SearchRecord) {
    super(record.query, vscode.TreeItemCollapsibleState.None)

    this.iconPath = new vscode.ThemeIcon("history")
    this.tooltip = `Search: ${record.query}`
    this.command = {
      command: "sensegrep.executeSearch",
      title: "Execute Search",
      arguments: [record],
    }
    this.contextValue = "recentSearchItem"
  }
}
