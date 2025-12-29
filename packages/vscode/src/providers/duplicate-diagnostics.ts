import * as vscode from "vscode"
import * as path from "node:path"
import { DuplicateGroup, SensegrepCore } from "../core"

const severityByLevel: Record<string, vscode.DiagnosticSeverity> = {
  exact: vscode.DiagnosticSeverity.Warning,
  high: vscode.DiagnosticSeverity.Warning,
  medium: vscode.DiagnosticSeverity.Information,
  low: vscode.DiagnosticSeverity.Hint,
}

export class DuplicateDiagnosticsManager implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection(
    "sensegrep-duplicates"
  )

  constructor(private readonly core: SensegrepCore) {}

  update(duplicates: DuplicateGroup[]) {
    const config = vscode.workspace.getConfiguration("sensegrep")
    if (!config.get<boolean>("showDiagnostics")) {
      this.collection.clear()
      return
    }

    const byFile = new Map<string, vscode.Diagnostic[]>()

    for (const group of duplicates) {
      const similarity = Math.round(group.similarity * 100)
      const severity =
        severityByLevel[group.level] ?? vscode.DiagnosticSeverity.Information
      const instanceCount = group.instances.length

      for (const instance of group.instances) {
        const filePath = path.isAbsolute(instance.file)
          ? instance.file
          : path.join(this.core.getRootDir(), instance.file)
        const range = new vscode.Range(
          Math.max(0, instance.startLine - 1),
          0,
          Math.max(0, instance.endLine - 1),
          0
        )

        const message = `Duplicate code (${group.level}, ${similarity}% similar) with ${instanceCount - 1} other instance(s).`
        const diagnostic = new vscode.Diagnostic(range, message, severity)
        diagnostic.source = "sensegrep"

        const list = byFile.get(filePath) ?? []
        list.push(diagnostic)
        byFile.set(filePath, list)
      }
    }

    this.collection.clear()
    for (const [filePath, diagnostics] of byFile) {
      this.collection.set(vscode.Uri.file(filePath), diagnostics)
    }
  }

  clear() {
    this.collection.clear()
  }

  dispose() {
    this.collection.dispose()
  }
}
