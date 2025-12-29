import * as vscode from "vscode"
import { SensegrepCore } from "../core"
import { StatusBarManager } from "./statusbar"

export function isIndexCorruptionError(error: unknown): boolean {
  const message = String(error ?? "")
  return (
    message.includes("Failed to get next batch from stream") ||
    message.includes("LanceError(IO)") ||
    message.includes("chunks.lance") ||
    message.includes("External error: Not found")
  )
}

export async function tryRecoverIndex(
  core: SensegrepCore,
  error: unknown,
  statusBar?: StatusBarManager,
  retry?: () => Promise<void>
): Promise<boolean> {
  if (!isIndexCorruptionError(error)) return false

  const action = await vscode.window.showWarningMessage(
    "Sensegrep index appears corrupted or missing files. Repair it now?",
    { modal: true },
    "Repair (Delete + Reindex)",
    "Reindex Full"
  )

  if (!action) return false

  try {
    statusBar?.setIndexing()
    if (action.startsWith("Repair")) {
      await core.deleteIndex()
    }
    const result = await core.indexProject(true)
    statusBar?.setIndexed(result.chunks)
    if (retry) {
      await retry()
    }
  } catch (reindexError) {
    statusBar?.setError(String(reindexError))
    vscode.window.showErrorMessage(`Index repair failed: ${reindexError}`)
  }

  return true
}
