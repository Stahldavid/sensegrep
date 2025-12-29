import * as vscode from "vscode"
import { SensegrepCore } from "../core"

export class SensegrepCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  constructor(private core: SensegrepCore) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration("sensegrep")
    if (!config.get<boolean>("showCodeLens")) {
      return []
    }

    const codeLenses: vscode.CodeLens[] = []

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    )

    if (!symbols) return []

    // Add CodeLens for functions and methods
    const processSymbols = (symbols: vscode.DocumentSymbol[], parent?: vscode.DocumentSymbol) => {
      for (const symbol of symbols) {
        if (
          symbol.kind === vscode.SymbolKind.Function ||
          symbol.kind === vscode.SymbolKind.Method
        ) {
          const range = new vscode.Range(symbol.range.start, symbol.range.start)

          // "Find Similar" CodeLens
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: "$(search) Find Similar",
              command: "sensegrep.searchSelection",
              tooltip: "Find semantically similar code",
            })
          )
        }

        // Process nested symbols
        if (symbol.children) {
          processSymbols(symbol.children, symbol)
        }
      }
    }

    processSymbols(symbols)

    return codeLenses
  }

  refresh() {
    this._onDidChangeCodeLenses.fire()
  }
}
