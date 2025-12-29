export function getSearchViewHtml(
  webview: { cspSource: string },
  nonce: string,
  _scriptUri?: string,
  _styleUri?: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} https: data:;
  ">
  <title>Sensegrep Search</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', sans-serif);
      --container-padding: 16px;
    }
    
    * {
      box-sizing: border-box;
    }
    
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    
    .container {
      padding: var(--container-padding);
      max-width: 100%;
    }
    
    .search-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .search-header h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .search-box {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    
    .search-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-size: 13px;
      outline: none;
    }
    
    .search-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    
    .search-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .filters {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }
    
    .filters-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .filter-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }
    
    .filter-group select,
    .filter-group input[type="number"],
    .filter-group input[type="text"] {
      padding: 6px 8px;
      border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border-radius: 4px;
      font-size: 12px;
    }
    
    .filter-checkboxes {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    
    .checkbox-item input[type="checkbox"] {
      margin: 0;
    }
    
    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .summary-container {
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
    }

    .summary-card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .summary-value {
      font-size: 16px;
      font-weight: 600;
    }

    .summary-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }

    .gap-list {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .gap-title {
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }

    .gap-item {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .shaked-container {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .shaked-header {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }

    .shaked-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
    }

    .shaked-item-header {
      padding: 8px 10px;
      background: var(--vscode-sideBar-background);
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    .shaked-item-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      gap: 8px;
    }
    
    .results-count {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    
    .results-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .result-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    
    .result-item:hover {
      border-color: var(--vscode-focusBorder);
    }
    
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 10px 12px;
      background: var(--vscode-sideBar-background);
      cursor: pointer;
    }
    
    .result-file {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .result-file-path {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
    }
    
    .result-symbol {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .result-meta {
      display: flex;
      gap: 12px;
      font-size: 11px;
    }
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .relevance-high { color: var(--vscode-charts-green); }
    .relevance-medium { color: var(--vscode-charts-yellow); }
    .relevance-low { color: var(--vscode-charts-orange); }
    
    .result-code {
      padding: 0;
      margin: 0;
      max-height: 200px;
      overflow: auto;
    }
    
    .result-code pre {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.5;
      background: var(--vscode-editor-background);
      overflow-x: auto;
    }
    
    .result-code code {
      font-family: inherit;
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }
    
    .loading-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 12px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    .hidden {
      display: none !important;
    }
    
    .api-key-banner {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .api-key-banner-icon {
      font-size: 20px;
    }
    
    .api-key-banner-text {
      flex: 1;
      font-size: 12px;
    }
    
    .api-key-banner .btn {
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- API Key Banner (shown when using Gemini without key) -->
    <div id="apiKeyBanner" class="api-key-banner hidden">
      <span class="api-key-banner-icon">⚠️</span>
      <span class="api-key-banner-text">
        Gemini API key required for cloud embeddings. 
        <a href="#" id="setApiKeyLink">Set API Key</a> or switch to local embeddings.
      </span>
    </div>
    
    <!-- Search Header -->
    <div class="search-header">
      <h2>🧬 Semantic Code Search</h2>
    </div>
    
    <!-- Search Box -->
    <div class="search-box">
      <input 
        type="text" 
        id="searchInput" 
        class="search-input" 
        placeholder="Describe what you're looking for... (e.g., 'authentication with JWT')"
        autofocus
      >
      <button id="searchBtn" class="btn btn-primary">
        🔍 Search
      </button>
      <button id="saveSearchBtn" class="btn btn-secondary">
        ⭐ Save
      </button>
    </div>
    
    <!-- Filters -->
    <div class="filters">
      <div class="filters-header">
        <span>Filters</span>
        <button id="resetFilters" class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;">Reset</button>
      </div>
      <div class="filters-grid">
        <div class="filter-group">
          <label>Symbol Type</label>
          <select id="symbolType">
            <option value="">All</option>
            <option value="function">Function</option>
            <option value="method">Method</option>
            <option value="class">Class</option>
            <option value="interface">Interface</option>
            <option value="type">Type</option>
            <option value="variable">Variable</option>
            <option value="namespace">Namespace</option>
            <option value="enum">Enum</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Symbol Name</label>
          <input type="text" id="symbolName" placeholder="e.g. VectorStore">
        </div>

        <div class="filter-group">
          <label>Language</label>
          <select id="language">
            <option value="">All</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="tsx">TSX</option>
            <option value="jsx">JSX</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Parent Scope</label>
          <input type="text" id="parentScope" placeholder="e.g. AuthService">
        </div>

        <div class="filter-group">
          <label>Imports</label>
          <input type="text" id="imports" placeholder="e.g. react">
        </div>

        <div class="filter-group">
          <label>File Pattern</label>
          <input type="text" id="includePattern" placeholder="*.ts, src/**/*.tsx">
        </div>

        <div class="filter-group">
          <label>Exclude Pattern</label>
          <input type="text" id="excludePattern" placeholder="*.test.ts, **/__mocks__/**">
        </div>

        <div class="filter-group">
          <label>Regex Filter</label>
          <input type="text" id="pattern" placeholder="e.g. auth|jwt">
        </div>

        <div class="filter-group">
          <label>Min Score</label>
          <input type="number" id="minScore" min="0" max="1" step="0.01" placeholder="0.0 - 1.0">
        </div>

        <div class="filter-group">
          <label>Max Results</label>
          <input type="number" id="maxResults" value="20" min="1" max="100">
        </div>

        <div class="filter-group">
          <label>Max / File</label>
          <input type="number" id="maxPerFile" min="0" placeholder="default">
        </div>

        <div class="filter-group">
          <label>Max / Symbol</label>
          <input type="number" id="maxPerSymbol" min="0" placeholder="default">
        </div>

        <div class="filter-group">
          <label>Complexity</label>
          <div style="display: flex; gap: 8px;">
            <input type="number" id="minComplexity" placeholder="Min" min="0" style="width: 60px;">
            <input type="number" id="maxComplexity" placeholder="Max" min="0" style="width: 60px;">
          </div>
        </div>
        
        <div class="filter-group filter-checkboxes">
          <label>Options</label>
          <label class="checkbox-item">
            <input type="checkbox" id="exportedOnly">
            Exported only
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="hasDocumentation">
            With documentation
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="enableRerank">
            Enable reranking
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="shakeOutput">
            Tree-shake output
          </label>
        </div>
      </div>
    </div>
    
    <!-- Loading State -->
    <div id="loadingState" class="loading hidden">
      <div class="loading-spinner"></div>
      <span>Searching...</span>
    </div>
    
    <!-- Empty State -->
    <div id="emptyState" class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div>Enter a search query to find relevant code</div>
    </div>
    
    <!-- Results -->
    <div id="resultsContainer" class="hidden">
      <div class="results-header">
        <span class="results-count" id="resultsCount">0 results</span>
      </div>
      <div id="summaryContainer" class="summary-container hidden">
        <div class="summary" id="summaryCards"></div>
        <div class="gap-list" id="gapList"></div>
      </div>
      <div id="resultsList" class="results-list"></div>
      <div id="shakedContainer" class="shaked-container hidden">
        <div class="shaked-header">Tree-shaken Output</div>
        <div id="shakedList" class="results-list"></div>
      </div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    // Elements
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const saveSearchBtn = document.getElementById('saveSearchBtn');
    const symbolType = document.getElementById('symbolType');
    const symbolName = document.getElementById('symbolName');
    const language = document.getElementById('language');
    const parentScope = document.getElementById('parentScope');
    const imports = document.getElementById('imports');
    const includePattern = document.getElementById('includePattern');
    const excludePattern = document.getElementById('excludePattern');
    const maxResults = document.getElementById('maxResults');
    const pattern = document.getElementById('pattern');
    const minScore = document.getElementById('minScore');
    const maxPerFile = document.getElementById('maxPerFile');
    const maxPerSymbol = document.getElementById('maxPerSymbol');
    const minComplexity = document.getElementById('minComplexity');
    const maxComplexity = document.getElementById('maxComplexity');
    const exportedOnly = document.getElementById('exportedOnly');
    const hasDocumentation = document.getElementById('hasDocumentation');       
    const enableRerank = document.getElementById('enableRerank');
    const shakeOutput = document.getElementById('shakeOutput');
    const resetFilters = document.getElementById('resetFilters');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');
    const resultsContainer = document.getElementById('resultsContainer');       
    const resultsList = document.getElementById('resultsList');
    const resultsCount = document.getElementById('resultsCount');
    const summaryContainer = document.getElementById('summaryContainer');
    const summaryCards = document.getElementById('summaryCards');
    const gapList = document.getElementById('gapList');
    const shakedContainer = document.getElementById('shakedContainer');
    const shakedList = document.getElementById('shakedList');
    const apiKeyBanner = document.getElementById('apiKeyBanner');
    const setApiKeyLink = document.getElementById('setApiKeyLink');
    
    // State
    let isSearching = false;
    
    // Event Listeners
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') performSearch();
    });

    saveSearchBtn.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (!query) return;
      vscode.postMessage({
        type: 'saveSearch',
        query,
        options: collectOptions()
      });
    });
    
    resetFilters.addEventListener('click', () => {
      symbolType.value = '';
      symbolName.value = '';
      language.value = '';
      parentScope.value = '';
      imports.value = '';
      includePattern.value = '';
      excludePattern.value = '';
      pattern.value = '';
      minScore.value = '';
      maxResults.value = '20';
      maxPerFile.value = '';
      maxPerSymbol.value = '';
      minComplexity.value = '';
      maxComplexity.value = '';
      exportedOnly.checked = false;
      hasDocumentation.checked = false;
      enableRerank.checked = false;
      shakeOutput.checked = false;
    });
    
    setApiKeyLink.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'setApiKey' });
    });
    
    function performSearch() {
      const query = searchInput.value.trim();
      if (!query || isSearching) return;
      
      isSearching = true;
      showLoading();
      
      vscode.postMessage({
        type: 'search',
        query,
        options: collectOptions()
      });
    }

    function collectOptions() {
      return {
        symbolType: symbolType.value || undefined,
        symbol: symbolName.value || undefined,
        language: language.value || undefined,
        parentScope: parentScope.value || undefined,
        imports: imports.value || undefined,
        include: includePattern.value || undefined,
        exclude: excludePattern.value || undefined,
        pattern: pattern.value || undefined,
        limit: parseInt(maxResults.value) || 20,
        minScore: minScore.value ? parseFloat(minScore.value) : undefined,
        maxPerFile: maxPerFile.value ? parseInt(maxPerFile.value) : undefined,
        maxPerSymbol: maxPerSymbol.value ? parseInt(maxPerSymbol.value) : undefined,
        minComplexity: minComplexity.value ? parseInt(minComplexity.value) : undefined,
        maxComplexity: maxComplexity.value ? parseInt(maxComplexity.value) : undefined,
        isExported: exportedOnly.checked || undefined,
        hasDocumentation: hasDocumentation.checked || undefined,
        rerank: enableRerank.checked,
        shakeOutput: shakeOutput.checked
      };
    }
    
    function showLoading() {
      loadingState.classList.remove('hidden');
      emptyState.classList.add('hidden');
      resultsContainer.classList.add('hidden');
      summaryContainer.classList.add('hidden');
      shakedContainer.classList.add('hidden');
    }
    
    function showResults(results, summary, shakedFiles) {
      isSearching = false;
      loadingState.classList.add('hidden');
      emptyState.classList.add('hidden');
      
      if (!results || results.length === 0) {
        emptyState.querySelector('div:last-child').textContent = 'No results found';
        emptyState.classList.remove('hidden');
        return;
      }

      resultsContainer.classList.remove('hidden');
      resultsCount.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');

      renderSummary(summary);
      renderShaked(shakedFiles);

      resultsList.innerHTML = results.map((result, index) => {
        const relevanceClass = result.relevance >= 0.8 ? 'relevance-high' :     
                               result.relevance >= 0.6 ? 'relevance-medium' : 'relevance-low';
        const relevancePercent = Math.round(result.relevance * 100);
        const explain = formatExplain(result);

        return \`
          <div class="result-item" data-index="\${index}">
            <div class="result-header" onclick="goToResult(\${index})">
              <div class="result-file">
                <span class="result-file-path">\${escapeHtml(result.file)}:\${result.startLine}</span>
                <span class="result-symbol">
                  \${result.symbolType ? \`<span>[\${result.symbolType}]</span>\` : ''}
                  \${result.symbolName ? \`<span>\${escapeHtml(result.symbolName)}</span>\` : ''}
                </span>
              </div>
              <div class="result-meta">
                <span class="meta-item \${relevanceClass}">
                  📊 \${relevancePercent}%
                </span>
                \${typeof result.rerankScore === 'number' ? \`<span class="meta-item">🎯 \${result.rerankScore.toFixed(3)}</span>\` : ''}
                \${result.complexity ? \`<span class="meta-item">⚡ \${result.complexity}</span>\` : ''}
                \${result.parentScope ? \`<span class="meta-item">🏷️ \${escapeHtml(result.parentScope)}</span>\` : ''}
                \${result.isExported ? '<span class="meta-item">📤 exported</span>' : ''}
                <span class="meta-item" title="\${escapeHtml(explain)}">ⓘ</span>
              </div>
            </div>
            <div class="result-code">
              <pre><code>\${escapeHtml(result.content)}</code></pre>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderSummary(summary) {
      if (!summary) {
        summaryContainer.classList.add('hidden');
        return;
      }

      summaryContainer.classList.remove('hidden');
      summaryCards.innerHTML = \`
        <div class="summary-card">
          <div class="summary-value">\${summary.totalResults}</div>
          <div class="summary-label">Results</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">\${summary.fileCount}</div>
          <div class="summary-label">Files</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">\${summary.symbolCount}</div>
          <div class="summary-label">Symbols</div>
        </div>
      \`;

      if (!summary.indexed || !summary.gaps || summary.gaps.length === 0) {
        gapList.innerHTML = \`<div class="gap-title">Top lacunas reais</div><div>Nenhuma lacuna relevante detectada.</div>\`;
        return;
      }

      gapList.innerHTML = \`
        <div class="gap-title">Top lacunas reais</div>
        \${summary.gaps.map((gap) => \`
          <div class="gap-item">
            <span>\${escapeHtml(gap.folder)}</span>
            <span>\${gap.matchedFiles}/\${gap.totalFiles} arquivos</span>
          </div>
        \`).join('')}
      \`;
    }

    function renderShaked(shakedFiles) {
      if (!shakedFiles || shakedFiles.length === 0) {
        shakedContainer.classList.add('hidden');
        shakedList.innerHTML = '';
        return;
      }

      shakedContainer.classList.remove('hidden');
      shakedList.innerHTML = shakedFiles.map((entry) => \`
        <div class="shaked-item">
          <div class="shaked-item-header">
            <span>\${escapeHtml(entry.file)}</span>
            <span class="shaked-item-meta">
              <span>\${entry.matchCount} match(es)</span>
              <span>\${entry.stats.hiddenLines} linhas ocultas</span>
            </span>
          </div>
          <div class="result-code">
            <pre><code>\${escapeHtml(entry.content)}</code></pre>
          </div>
        </div>
      \`).join('');
    }
    
    function showError(message) {
      isSearching = false;
      loadingState.classList.add('hidden');
      emptyState.querySelector('.empty-state-icon').textContent = '❌';
      emptyState.querySelector('div:last-child').textContent = message;
      emptyState.classList.remove('hidden');
      resultsContainer.classList.add('hidden');
      summaryContainer.classList.add('hidden');
      shakedContainer.classList.add('hidden');
    }
    
    function goToResult(index) {
      vscode.postMessage({ type: 'goToResult', index });
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatExplain(result) {
      const parts = [];
      parts.push(\`Relevance: \${Math.round(result.relevance * 100)}%\`);
      if (typeof result.rerankScore === 'number') {
        parts.push(\`Rerank: \${result.rerankScore.toFixed(3)}\`);
      }
      if (result.symbolType || result.symbolName) {
        const label = [result.symbolType, result.symbolName].filter(Boolean).join(' ');
        parts.push(\`Symbol: \${label}\`);
      }
      if (result.parentScope) {
        parts.push(\`Parent: \${result.parentScope}\`);
      }
      if (typeof result.complexity === 'number') {
        parts.push(\`Complexity: \${result.complexity}\`);
      }
      if (result.isExported) {
        parts.push('Exported: true');
      }
      return parts.join(' | ');
    }
    
    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'results':
          showResults(message.results, message.summary, message.shakedFiles);
          break;
        case 'error':
          showError(message.message);
          break;
        case 'showApiKeyBanner':
          apiKeyBanner.classList.remove('hidden');
          break;
        case 'hideApiKeyBanner':
          apiKeyBanner.classList.add('hidden');
          break;
      }
    });
    
    // Expose function globally
    window.goToResult = goToResult;
  </script>
</body>
</html>`;
}

export function getDuplicatesViewHtml(
  webview: { cspSource: string },
  nonce: string
): string {
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
  <title>Duplicate Detection</title>
  <style>
    :root {
      --container-padding: 16px;
    }
    
    * { box-sizing: border-box; }
    
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    
    .container { padding: var(--container-padding); }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .header h2 {
      margin: 0;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .filters {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .filters-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }

    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .filter-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }

    .filter-group input,
    .filter-group select {
      padding: 6px 8px;
      border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border-radius: 4px;
      font-size: 12px;
    }

    .filter-checkboxes {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .checkbox-item input[type="checkbox"] {
      margin: 0;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    
    .summary-card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    
    .summary-value {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    
    .summary-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }
    
    .level-badges {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 8px;
    }
    
    .level-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    
    .level-exact { background: #ff4444; color: white; }
    .level-high { background: #ff8800; color: white; }
    .level-medium { background: #ffcc00; color: black; }
    .level-low { background: #88cc00; color: black; }
    
    .duplicates-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .duplicate-group {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
    }
    
    .duplicate-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--vscode-sideBar-background);
      cursor: pointer;
    }

    .duplicate-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .compare-btn {
      padding: 4px 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    .compare-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
    }
    
    .duplicate-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .duplicate-stats {
      display: flex;
      gap: 16px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .duplicate-tags {
      display: flex;
      gap: 6px;
      align-items: center;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .tag {
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 10px;
      text-transform: uppercase;
    }

    .tag-ok {
      background: #2d8f4e;
      color: white;
    }

    .summary-note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
    }
    
    .duplicate-instances {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .instance {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      border-radius: 4px;
      cursor: pointer;
    }
    
    .instance:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .instance-file {
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
    }
    
    .instance-symbol {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .instance-code {
      margin-top: 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: auto;
    }

    .instance-code pre {
      margin: 0;
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.5;
      white-space: pre;
    }

    .section-title {
      margin-top: 16px;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    
    .loading, .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground);
    }
    
    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--vscode-progressBar-background);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚠️ Duplicate Code Detector</h2>
      <button id="analyzeBtn" class="btn">🔄 Analyze</button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filters-header">
        <span>Filters</span>
        <button id="resetDuplicateFilters" class="btn" style="padding: 4px 8px; font-size: 11px;">Reset</button>
      </div>
      <div class="filters-grid">
        <div class="filter-group">
          <label>Threshold</label>
          <input type="number" id="dupThreshold" value="0.85" min="0.5" max="1" step="0.01">
        </div>
        <div class="filter-group">
          <label>Scope</label>
          <select id="dupScope">
            <option value="">Function + Method</option>
            <option value="function">Function only</option>
            <option value="method">Method only</option>
            <option value="all">All</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Min Lines</label>
          <input type="number" id="dupMinLines" value="10" min="1">
        </div>
        <div class="filter-group">
          <label>Min Complexity</label>
          <input type="number" id="dupMinComplexity" value="0" min="0">
        </div>
        <div class="filter-group">
          <label>Exclude Pattern</label>
          <input type="text" id="dupExcludePattern" placeholder="e.g. ^test|mock">
        </div>
        <div class="filter-group">
          <label>Top N</label>
          <input type="number" id="dupLimit" placeholder="all" min="1">
        </div>
        <div class="filter-group filter-checkboxes">
          <label>Options</label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupIgnoreTests" checked>
            Ignore tests
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupCrossFileOnly">
            Cross-file only
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupOnlyExported">
            Exported only
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupNormalizeIdentifiers" checked>
            Normalize identifiers
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupRankByImpact" checked>
            Rank by impact
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupIgnoreAcceptable">
            Ignore acceptable patterns
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupShowAcceptable" checked>
            Show acceptable duplicates
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupShowCode">
            Show code
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="dupFullCode">
            Full code
          </label>
        </div>
      </div>
    </div>
    
    <!-- Loading -->
    <div id="loadingState" class="loading hidden">
      <div class="loading-spinner"></div>
      <div>Analyzing codebase for duplicates...</div>
    </div>
    
    <!-- Empty State -->
    <div id="emptyState" class="empty-state">
      <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
      <div>Click "Analyze" to detect duplicate code</div>
    </div>
    
    <!-- Results -->
    <div id="resultsContainer" class="hidden">
      <div class="summary" id="summary"></div>
      <div class="summary-note" id="summaryNote"></div>
      <div class="duplicates-list" id="duplicatesList"></div>
      <div class="section-title hidden" id="acceptableTitle">Acceptable Duplicates</div>
      <div class="duplicates-list" id="acceptableList"></div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    const analyzeBtn = document.getElementById('analyzeBtn');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');
    const resultsContainer = document.getElementById('resultsContainer');
    const summary = document.getElementById('summary');
    const summaryNote = document.getElementById('summaryNote');
    const duplicatesList = document.getElementById('duplicatesList');
    const acceptableList = document.getElementById('acceptableList');
    const acceptableTitle = document.getElementById('acceptableTitle');

    const dupThreshold = document.getElementById('dupThreshold');
    const dupScope = document.getElementById('dupScope');
    const dupMinLines = document.getElementById('dupMinLines');
    const dupMinComplexity = document.getElementById('dupMinComplexity');       
    const dupExcludePattern = document.getElementById('dupExcludePattern');     
    const dupLimit = document.getElementById('dupLimit');
    const dupIgnoreTests = document.getElementById('dupIgnoreTests');
    const dupCrossFileOnly = document.getElementById('dupCrossFileOnly');       
    const dupOnlyExported = document.getElementById('dupOnlyExported');
    const dupNormalizeIdentifiers = document.getElementById('dupNormalizeIdentifiers');
    const dupRankByImpact = document.getElementById('dupRankByImpact');
    const dupIgnoreAcceptable = document.getElementById('dupIgnoreAcceptable');
    const dupShowAcceptable = document.getElementById('dupShowAcceptable');
    const dupShowCode = document.getElementById('dupShowCode');
    const dupFullCode = document.getElementById('dupFullCode');
    const resetDuplicateFilters = document.getElementById('resetDuplicateFilters');

    resetDuplicateFilters.addEventListener('click', () => {
      dupThreshold.value = '0.85';
      dupScope.value = '';
      dupMinLines.value = '10';
      dupMinComplexity.value = '0';
      dupExcludePattern.value = '';
      dupLimit.value = '';
      dupIgnoreTests.checked = true;
      dupCrossFileOnly.checked = false;
      dupOnlyExported.checked = false;
      dupNormalizeIdentifiers.checked = true;
      dupRankByImpact.checked = true;
      dupIgnoreAcceptable.checked = false;
      dupShowAcceptable.checked = true;
      dupShowCode.checked = false;
      dupFullCode.checked = false;
    });

    analyzeBtn.addEventListener('click', () => {
      loadingState.classList.remove('hidden');
      emptyState.classList.add('hidden');
      resultsContainer.classList.add('hidden');
      const wantsFull = dupFullCode.checked;
      const wantsCode = wantsFull || dupShowCode.checked;
      vscode.postMessage({
        type: 'analyze',
        options: {
          threshold: dupThreshold.value ? parseFloat(dupThreshold.value) : undefined,
          scope: dupScope.value || undefined,
          minLines: dupMinLines.value ? parseInt(dupMinLines.value) : undefined,
          minComplexity: dupMinComplexity.value ? parseInt(dupMinComplexity.value) : undefined,
          excludePattern: dupExcludePattern.value || undefined,
          limit: dupLimit.value ? parseInt(dupLimit.value) : undefined,
          ignoreTests: dupIgnoreTests.checked,
          crossFileOnly: dupCrossFileOnly.checked,
          onlyExported: dupOnlyExported.checked,
          normalizeIdentifiers: dupNormalizeIdentifiers.checked,
          rankByImpact: dupRankByImpact.checked,
          ignoreAcceptablePatterns: dupIgnoreAcceptable.checked,
          showAcceptable: dupShowAcceptable.checked,
          showCode: wantsCode,
          fullCode: wantsFull,
        },
      });
    });
    
    function showResults(data, options) {
      loadingState.classList.add('hidden');

      if (!data.duplicates || data.duplicates.length === 0) {
        emptyState.querySelector('div:last-child').textContent = '✅ No duplicates found!';
        emptyState.classList.remove('hidden');
        return;
      }

      resultsContainer.classList.remove('hidden');

      // Render summary
      summary.innerHTML = \`
        <div class="summary-card">
          <div class="summary-value">\${data.summary.totalDuplicates}</div>
          <div class="summary-label">Total Duplicates</div>
          <div class="level-badges">
            \${data.summary.byLevel.exact ? \`<span class=\\"level-badge level-exact\\">\${data.summary.byLevel.exact} Exact</span>\` : ''}
            \${data.summary.byLevel.high ? \`<span class=\\"level-badge level-high\\">\${data.summary.byLevel.high} High</span>\` : ''}
            \${data.summary.byLevel.medium ? \`<span class=\\"level-badge level-medium\\">\${data.summary.byLevel.medium} Med</span>\` : ''}
            \${data.summary.byLevel.low ? \`<span class=\\"level-badge level-low\\">\${data.summary.byLevel.low} Low</span>\` : ''}
          </div>
        </div>
        <div class="summary-card">
          <div class="summary-value">\${data.summary.filesAffected}</div>
          <div class="summary-label">Files Affected</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">~\${data.summary.totalSavings}</div>
          <div class="summary-label">Lines Savable</div>
        </div>
      \`;

      if (data.display && data.display.limit && data.display.total > data.display.shown) {
        summaryNote.textContent = \`Showing top \${data.display.shown} of \${data.display.total} duplicate groups\`;
      } else {
        summaryNote.textContent = '';
      }

      const wantsFull = options && options.fullCode;
      const wantsCode = (options && options.showCode) || wantsFull;

      const renderInstance = (inst, groupIdx, instanceIdx, kind) => {
        const lines = inst.content ? inst.content.split('\\n') : [];
        const maxLines = wantsFull ? lines.length : wantsCode ? 15 : 0;
        const codeLines = maxLines > 0 ? lines.slice(0, maxLines) : [];
        const truncated = lines.length > maxLines && maxLines > 0;
        return \`
          <div class="instance" onclick="goToInstance('\${kind}', \${groupIdx}, \${instanceIdx})">
            <div>
              <div class="instance-file">\${escapeHtml(inst.file)}:\${inst.startLine}</div>
              <div class="instance-symbol">\${escapeHtml(inst.symbol || 'anonymous')}</div>
            </div>
            <span>⚡ \${inst.complexity || '-'} </span>
          </div>
          \${maxLines > 0 ? '<div class="instance-code"><pre><code>' + escapeHtml(codeLines.join('\\n')) + (truncated ? '\\n... (' + (lines.length - maxLines) + ' more lines)' : '') + '</code></pre></div>' : ''}
        \`;
      };

      const renderGroup = (group, idx, kind) => \`
        <div class="duplicate-group">
          <div class="duplicate-header">
            <div class="duplicate-title">
              <span class="level-badge level-\${group.level}">\${group.level.toUpperCase()}</span>
              <span>\${Math.round(group.similarity * 100)}% similar</span>
            </div>
            <div class="duplicate-actions"><div class="duplicate-stats">
              <span>📊 Impact: \${group.impact.score.toFixed(0)}</span>
              <span>💾 Save ~\${group.impact.estimatedSavings} lines</span>
            </div><div class="duplicate-tags">
              \${group.category ? \`<span class=\\"tag\\">\${escapeHtml(group.category)}</span>\` : ''}
              \${group.isLikelyOk ? \`<span class=\\"tag tag-ok\\">Likely OK</span>\` : ''}
            </div><button class="compare-btn" onclick="compareGroup('\${kind}', \${idx})">Compare</button></div>
          </div>
          <div class="duplicate-instances">
            \${group.instances.map((inst, iIdx) => renderInstance(inst, idx, iIdx, kind)).join('')}
          </div>
        </div>
      \`;

      duplicatesList.innerHTML = data.duplicates.map((group, idx) => renderGroup(group, idx, 'duplicates')).join('');

      if (data.acceptableDuplicates && data.acceptableDuplicates.length > 0) {
        acceptableTitle.classList.remove('hidden');
        acceptableList.innerHTML = data.acceptableDuplicates.map((group, idx) => renderGroup(group, idx, 'acceptable')).join('');
      } else {
        acceptableTitle.classList.add('hidden');
        acceptableList.innerHTML = '';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text ?? '';
      return div.innerHTML;
    }

    function goToInstance(kind, groupIdx, instanceIdx) {
      vscode.postMessage({ type: 'goToInstance', kind, groupIdx, instanceIdx });
    }

    function compareGroup(kind, groupIdx) {
      vscode.postMessage({ type: 'compareGroup', kind, groupIdx });
    }
    
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'results') {
        showResults(message.data, message.options);
      } else if (message.type === 'error') {
        loadingState.classList.add('hidden');
        emptyState.querySelector('div:last-child').textContent = '❌ ' + message.message;
        emptyState.classList.remove('hidden');
      }
    });
    
    window.goToInstance = goToInstance;
    window.compareGroup = compareGroup;
  </script>
</body>
</html>`;
}

export function getSettingsViewHtml(
  webview: { cspSource: string },
  nonce: string,
  currentApiKey: string | undefined,
  provider: string
): string {
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
        <option value="local" ${provider === 'local' ? 'selected' : ''}>Local (transformers.js)</option>
        <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Gemini (cloud)</option>
      </select>
      <div class="hint">Local is free but slower. Gemini requires API key but provides better results.</div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    const apiKeyInput = document.getElementById('apiKey');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const clearApiKeyBtn = document.getElementById('clearApiKey');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const providerSelect = document.getElementById('provider');
    
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
      }
    });
  </script>
</body>
</html>`;
}

export function getNonce(): string {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

