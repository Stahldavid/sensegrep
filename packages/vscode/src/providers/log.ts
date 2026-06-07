import * as vscode from "vscode"

export class SensegrepOutput implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel("Sensegrep", { log: true })

  info(message: string) {
    this.channel.info(message)
  }

  warn(message: string) {
    this.channel.warn(message)
  }

  error(message: string, error?: unknown) {
    const detail = error instanceof Error ? error.stack || error.message : error ? String(error) : ""
    this.channel.error(detail ? `${message}\n${detail}` : message)
  }

  show() {
    this.channel.show()
  }

  dispose() {
    this.channel.dispose()
  }
}
