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
          <label>Language</label>
          <select id="dupLanguage">
            <option value="">All</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="vue">Vue</option>
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
        <div class="filter-group">
          <label>Max Candidates</label>
          <input type="number" id="dupMaxCandidates" placeholder="1500" min="50">
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
            <input type="checkbox" id="dupCrossLanguage">
            Cross-language
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
    const dupLanguage = document.getElementById('dupLanguage');
    const dupMinLines = document.getElementById('dupMinLines');
    const dupMinComplexity = document.getElementById('dupMinComplexity');       
    const dupExcludePattern = document.getElementById('dupExcludePattern');     
    const dupLimit = document.getElementById('dupLimit');
    const dupMaxCandidates = document.getElementById('dupMaxCandidates');
    const dupIgnoreTests = document.getElementById('dupIgnoreTests');
    const dupCrossFileOnly = document.getElementById('dupCrossFileOnly');       
    const dupCrossLanguage = document.getElementById('dupCrossLanguage');
    const dupOnlyExported = document.getElementById('dupOnlyExported');
    const dupNormalizeIdentifiers = document.getElementById('dupNormalizeIdentifiers');
    const dupRankByImpact = document.getElementById('dupRankByImpact');
    const dupIgnoreAcceptable = document.getElementById('dupIgnoreAcceptable');
    const dupShowAcceptable = document.getElementById('dupShowAcceptable');
    const dupShowCode = document.getElementById('dupShowCode');
    const dupFullCode = document.getElementById('dupFullCode');
    const resetDuplicateFilters = document.getElementById('resetDuplicateFilters');
    let duplicateState = vscode.getState() || {};

    [
      dupThreshold,
      dupScope,
      dupLanguage,
      dupMinLines,
      dupMinComplexity,
      dupExcludePattern,
      dupLimit,
      dupMaxCandidates,
      dupIgnoreTests,
      dupCrossFileOnly,
      dupCrossLanguage,
      dupOnlyExported,
      dupNormalizeIdentifiers,
      dupRankByImpact,
      dupIgnoreAcceptable,
      dupShowAcceptable,
      dupShowCode,
      dupFullCode
    ].forEach((element) => {
      element.addEventListener('input', saveDuplicateState);
      element.addEventListener('change', saveDuplicateState);
    });

    resetDuplicateFilters.addEventListener('click', () => {
      dupThreshold.value = '0.85';
      dupScope.value = '';
      dupLanguage.value = '';
      dupMinLines.value = '10';
      dupMinComplexity.value = '0';
      dupExcludePattern.value = '';
      dupLimit.value = '';
      dupMaxCandidates.value = '';
      dupIgnoreTests.checked = true;
      dupCrossFileOnly.checked = false;
      dupCrossLanguage.checked = false;
      dupOnlyExported.checked = false;
      dupNormalizeIdentifiers.checked = true;
      dupRankByImpact.checked = true;
      dupIgnoreAcceptable.checked = false;
      dupShowAcceptable.checked = true;
      dupShowCode.checked = false;
      dupFullCode.checked = false;
      saveDuplicateState();
    });

    function collectDuplicateOptions() {
      const wantsFull = dupFullCode.checked;
      const wantsCode = wantsFull || dupShowCode.checked;
      return {
        threshold: dupThreshold.value ? parseFloat(dupThreshold.value) : undefined,
        scope: dupScope.value || undefined,
        language: dupLanguage.value || undefined,
        minLines: dupMinLines.value ? parseInt(dupMinLines.value) : undefined,
        minComplexity: dupMinComplexity.value ? parseInt(dupMinComplexity.value) : undefined,
        excludePattern: dupExcludePattern.value || undefined,
        limit: dupLimit.value ? parseInt(dupLimit.value) : undefined,
        maxCandidates: dupMaxCandidates.value ? parseInt(dupMaxCandidates.value) : undefined,
        ignoreTests: dupIgnoreTests.checked,
        crossFileOnly: dupCrossFileOnly.checked,
        crossLanguage: dupCrossLanguage.checked,
        onlyExported: dupOnlyExported.checked,
        normalizeIdentifiers: dupNormalizeIdentifiers.checked,
        rankByImpact: dupRankByImpact.checked,
        ignoreAcceptablePatterns: dupIgnoreAcceptable.checked,
        showAcceptable: dupShowAcceptable.checked,
        showCode: wantsCode,
        fullCode: wantsFull,
      };
    }

    function saveDuplicateState() {
      duplicateState = { options: collectDuplicateOptions() };
      vscode.setState(duplicateState);
    }

    function restoreDuplicateState() {
      const options = duplicateState.options || {};
      dupThreshold.value = options.threshold !== undefined ? String(options.threshold) : '0.85';
      dupScope.value = options.scope || '';
      dupLanguage.value = options.language || '';
      dupMinLines.value = options.minLines !== undefined ? String(options.minLines) : '10';
      dupMinComplexity.value = options.minComplexity !== undefined ? String(options.minComplexity) : '0';
      dupExcludePattern.value = options.excludePattern || '';
      dupLimit.value = options.limit !== undefined ? String(options.limit) : '';
      dupMaxCandidates.value = options.maxCandidates !== undefined ? String(options.maxCandidates) : '';
      dupIgnoreTests.checked = options.ignoreTests !== false;
      dupCrossFileOnly.checked = options.crossFileOnly === true;
      dupCrossLanguage.checked = options.crossLanguage === true;
      dupOnlyExported.checked = options.onlyExported === true;
      dupNormalizeIdentifiers.checked = options.normalizeIdentifiers !== false;
      dupRankByImpact.checked = options.rankByImpact !== false;
      dupIgnoreAcceptable.checked = options.ignoreAcceptablePatterns === true;
      dupShowAcceptable.checked = options.showAcceptable !== false;
      dupShowCode.checked = options.showCode === true;
      dupFullCode.checked = options.fullCode === true;
    }

    analyzeBtn.addEventListener('click', () => {
      loadingState.classList.remove('hidden');
      emptyState.classList.add('hidden');
      resultsContainer.classList.add('hidden');
      vscode.postMessage({
        type: 'analyze',
        options: collectDuplicateOptions(),
      });
    });

    restoreDuplicateState();
    
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

      const notes = [];
      if (data.display && data.display.limit && data.display.total > data.display.shown) {
        notes.push(\`Showing top \${data.display.shown} of \${data.display.total} duplicate groups\`);
      }
      if (data.summary && data.summary.truncated) {
        notes.push(\`Candidate analysis truncated: \${data.summary.analyzedCandidates || '?'} of \${data.summary.candidates || '?'} candidates analyzed\`);
      }
      summaryNote.textContent = notes.join(' · ');

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
