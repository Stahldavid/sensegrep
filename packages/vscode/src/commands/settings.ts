import * as vscode from "vscode"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { SensegrepCore } from "../core"
import type { SearchViewProvider } from "../views/search-view"
import type { SensegrepOutput } from "../providers/log"
import { isCredentialProvider, isEmbeddingProvider } from "../embedding-settings"
import { getNonce } from "../webview/nonce"
import { getSettingsViewHtml } from "../webview/templates"

export function createSettingsPanelController(input: {
  core: SensegrepCore
  searchViewProvider: SearchViewProvider
  output?: SensegrepOutput
}): { show: () => Promise<void> } {
  let settingsPanel: vscode.WebviewPanel | null = null

  const show = async () => {
    if (settingsPanel) {
      settingsPanel.reveal()
      return
    }

    const panel = vscode.window.createWebviewPanel(
      "sensegrep.settings",
      "Sensegrep Settings",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    settingsPanel = panel

    const render = async () => {
      const config = vscode.workspace.getConfiguration("sensegrep")
      const inspected = config.inspect<string>("embeddings.provider")
      const configuredProvider = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue
      const provider = isEmbeddingProvider(configuredProvider) ? configuredProvider : "config"
      const apiKeyConfigured = isCredentialProvider(provider)
        ? Boolean(await input.core.getEmbeddingApiKey(provider))
        : false
      const embeddingSettings = {
        model: config.get<string>("embeddings.model") ?? "",
        dimension: config.get<number>("embeddings.dimension") ?? 0,
        baseUrl: config.get<string>("embeddings.baseUrl") ?? "",
        region: config.get<string>("embeddings.region") ?? "",
        apiKeyConfigured,
      }

      panel.webview.html = getSettingsViewHtml(
        panel.webview,
        getNonce(),
        await input.core.getApiKey(),
        provider,
        embeddingSettings,
      )
    }

    panel.onDidDispose(() => { settingsPanel = null })
    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "saveApiKey":
          if (message.apiKey) {
            await input.core.setApiKey(message.apiKey)
            panel.webview.postMessage({ type: "apiKeySaved" })
            await input.searchViewProvider.refreshApiKeyBanner()
          }
          break
        case "clearApiKey":
          await input.core.clearApiKey()
          panel.webview.postMessage({ type: "apiKeyCleared" })
          await input.searchViewProvider.refreshApiKeyBanner()
          break
        case "setProvider":
          if (isEmbeddingProvider(message.provider)) {
            const config = vscode.workspace.getConfiguration("sensegrep")
            await config.update("embeddings.provider", message.provider, vscode.ConfigurationTarget.Workspace)
            await input.core.reloadSettings()
            panel.webview.postMessage({ type: "providerChanged", provider: message.provider })
            await input.searchViewProvider.refreshApiKeyBanner()
            await render()
          }
          break
        case "saveEmbeddingSettings": {
          const config = vscode.workspace.getConfiguration("sensegrep")
          await config.update("embeddings.model", String(message.model ?? ""), vscode.ConfigurationTarget.Workspace)
          await config.update("embeddings.dimension", Number(message.dimension || 0), vscode.ConfigurationTarget.Workspace)
          await config.update("embeddings.baseUrl", String(message.baseUrl ?? ""), vscode.ConfigurationTarget.Workspace)
          await config.update("embeddings.region", String(message.region ?? ""), vscode.ConfigurationTarget.Workspace)
          const provider = config.get<string>("embeddings.provider")
          if (isCredentialProvider(provider) && String(message.apiKey ?? "").trim()) {
            await input.core.setEmbeddingApiKey(provider, String(message.apiKey).trim())
          }
          await config.update("embeddings.apiKey", undefined, vscode.ConfigurationTarget.Workspace)
          await input.core.reloadSettings()
          panel.webview.postMessage({ type: "embeddingSettingsSaved" })
          await input.searchViewProvider.refreshApiKeyBanner()
          await render()
          break
        }
        case "clearEmbeddingApiKey": {
          const provider = vscode.workspace.getConfiguration("sensegrep").get<string>("embeddings.provider")
          if (isCredentialProvider(provider)) {
            await input.core.clearEmbeddingApiKey(provider)
            await input.core.reloadSettings()
            panel.webview.postMessage({ type: "embeddingApiKeyCleared" })
            await render()
          }
          break
        }
        case "openConfig": {
          const configPath = path.join(os.homedir(), ".config", "sensegrep", "config.json")
          await fs.mkdir(path.dirname(configPath), { recursive: true })
          await fs.access(configPath).catch(() =>
            fs.writeFile(configPath, "{\n  \"provider\": \"openai\"\n}\n", "utf8")
          )
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath))
          await vscode.window.showTextDocument(document, { preview: false })
          break
        }
        case "testEmbeddings":
          try {
            const result = await input.core.testEmbeddings()
            panel.webview.postMessage({ type: "embeddingTestResult", result })
          } catch (error) {
            input.output?.error("Embedding test failed", error)
            panel.webview.postMessage({ type: "embeddingTestError", message: String(error) })
          }
          break
      }
    })

    await render()
  }

  return { show }
}
