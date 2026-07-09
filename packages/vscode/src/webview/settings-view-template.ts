export function getSettingsViewHtml(
  webview: { cspSource: string },
  nonce: string,
  currentApiKey: string | undefined,
  provider: string,
  settings: {
    model?: string
    dimension?: number
    baseUrl?: string
    region?: string
    apiKey?: string
  } = {}
): string {
  const attr = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
  ">
  <title>Sensegrep Settings</title>
  <style>
    * { box-sizing: border-box; }
    
    body {
      padding: 20px;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      max-width: 600px;
    }
    
    h2 {
      margin: 0 0 20px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .section {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    
    .section-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .field {
      margin-bottom: 16px;
    }
    
    .field:last-child {
      margin-bottom: 0;
    }
    
    .field label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground);
    }
    
    .field input,
    .field select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-size: 13px;
    }
    
    .field input:focus,
    .field select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    .field-row {
      display: flex;
      gap: 12px;
    }
    
    .field-row .field {
      flex: 1;
    }
    
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    
    .btn-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    
    .status {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      margin-top: 12px;
    }
    
    .status-success {
      background: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
    }
    
    .status-warning {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
    }
    
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
    }
    
    .hidden { display: none; }
  </style>
</head>
<body>
  <h2>⚙️ Sensegrep Settings</h2>
  
  <div class="section">
    <div class="section-title">🔑 Gemini API Key</div>
    
    <div class="field">
      <label>API Key (stored securely in VS Code secrets)</label>
      <input type="password" id="apiKey" placeholder="Enter your Gemini API key..." value="${currentApiKey ? '••••••••••••••••' : ''}">
      <div class="hint">
        Get your API key from <a href="https://aistudio.google.com/apikey" style="color: var(--vscode-textLink-foreground);">Google AI Studio</a>
      </div>
    </div>
    
    <div class="btn-group">
      <button id="saveApiKey" class="btn btn-primary">💾 Save Key</button>
      <button id="clearApiKey" class="btn btn-danger" ${!currentApiKey ? 'disabled' : ''}>🗑️ Clear Key</button>
    </div>
    
    <div id="apiKeyStatus" class="status hidden"></div>
  </div>
  
  <div class="section">
    <div class="section-title">🧠 Embeddings Provider</div>
    
    <div class="field">
      <label>Provider</label>
      <select id="provider">
        <option value="config" ${provider === 'config' ? 'selected' : ''}>Config file / environment</option>
        <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Gemini (cloud)</option>
        <option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI-compatible</option>
        <option value="bedrock" ${provider === 'bedrock' ? 'selected' : ''}>Amazon Bedrock</option>
      </select>
      <div class="hint">Use Config file / environment for ~/.config/sensegrep/config.json, LM Studio, Bedrock API keys, or environment variables. Gemini has built-in key management here.</div>
    </div>

    <div class="field">
      <label>Embedding Model</label>
      <input type="text" id="embeddingModel" placeholder="e.g. text-embedding-jina-embeddings-v2-base-code" value="${attr(settings.model)}">
    </div>

    <div class="field-row">
      <div class="field">
        <label>Dimension</label>
        <input type="number" id="embeddingDimension" min="0" placeholder="0 = config default" value="${settings.dimension ? attr(settings.dimension) : ''}">
      </div>
      <div class="field">
        <label>Bedrock Region</label>
        <input type="text" id="embeddingRegion" placeholder="us-east-1" value="${attr(settings.region)}">
      </div>
    </div>

    <div class="field">
      <label>OpenAI-compatible Base URL</label>
      <input type="text" id="embeddingBaseUrl" placeholder="http://127.0.0.1:1234/v1" value="${attr(settings.baseUrl)}">
    </div>

    <div class="field">
      <label>Provider API Key</label>
      <input type="password" id="embeddingApiKey" placeholder="Optional; config/env preferred" value="${attr(settings.apiKey)}">
      <div class="hint">For long-lived credentials, prefer ~/.config/sensegrep/config.json or environment variables.</div>
    </div>

    <div class="btn-group">
      <button id="saveEmbeddingSettings" class="btn btn-primary">💾 Save Embeddings</button>
      <button id="openConfig" class="btn">📄 Open config.json</button>
      <button id="testEmbeddings" class="btn">🧪 Test Embeddings</button>
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    const apiKeyInput = document.getElementById('apiKey');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const clearApiKeyBtn = document.getElementById('clearApiKey');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const providerSelect = document.getElementById('provider');
    const embeddingModel = document.getElementById('embeddingModel');
    const embeddingDimension = document.getElementById('embeddingDimension');
    const embeddingRegion = document.getElementById('embeddingRegion');
    const embeddingBaseUrl = document.getElementById('embeddingBaseUrl');
    const embeddingApiKey = document.getElementById('embeddingApiKey');
    const saveEmbeddingSettingsBtn = document.getElementById('saveEmbeddingSettings');
    const openConfigBtn = document.getElementById('openConfig');
    const testEmbeddingsBtn = document.getElementById('testEmbeddings');
    
    saveApiKeyBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      if (!key || key === '••••••••••••••••') {
        showStatus('Please enter a valid API key', 'warning');
        return;
      }
      vscode.postMessage({ type: 'saveApiKey', apiKey: key });
    });
    
    clearApiKeyBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearApiKey' });
    });
    
    providerSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setProvider', provider: providerSelect.value });
    });

    saveEmbeddingSettingsBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveEmbeddingSettings',
        model: embeddingModel.value.trim(),
        dimension: embeddingDimension.value ? parseInt(embeddingDimension.value, 10) : 0,
        region: embeddingRegion.value.trim(),
        baseUrl: embeddingBaseUrl.value.trim(),
        apiKey: embeddingApiKey.value.trim(),
      });
    });

    openConfigBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openConfig' });
    });

    testEmbeddingsBtn.addEventListener('click', () => {
      showStatus('Testing embeddings...', 'warning');
      vscode.postMessage({ type: 'testEmbeddings' });
    });
    
    function showStatus(message, type) {
      apiKeyStatus.textContent = message;
      apiKeyStatus.className = 'status status-' + type;
      apiKeyStatus.classList.remove('hidden');
      setTimeout(() => apiKeyStatus.classList.add('hidden'), 3000);
    }
    
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'apiKeySaved':
          showStatus('✅ API key saved successfully!', 'success');
          apiKeyInput.value = '••••••••••••••••';
          clearApiKeyBtn.disabled = false;
          break;
        case 'apiKeyCleared':
          showStatus('API key cleared', 'warning');
          apiKeyInput.value = '';
          clearApiKeyBtn.disabled = true;
          break;
        case 'providerChanged':
          showStatus('Provider changed to ' + message.provider, 'success');
          break;
        case 'embeddingSettingsSaved':
          showStatus('Embedding settings saved', 'success');
          break;
        case 'embeddingTestResult':
          showStatus(
            'Embedding test OK: ' +
              (message.result.provider || 'provider') +
              ' / ' +
              (message.result.model || 'model') +
              ' / vector ' +
              message.result.vectorLength,
            'success'
          );
          break;
        case 'embeddingTestError':
          showStatus('Embedding test failed: ' + message.message, 'warning');
          break;
      }
    });
  </script>
</body>
</html>`;
}
