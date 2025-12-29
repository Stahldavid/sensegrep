# Sensegrep VS Code Extension

Semantic + structural code search with AI-powered duplicate detection.

## Features

- 🔍 **Semantic Search** - Natural language queries to find relevant code
- 🔥 **Duplicate Detection** - AI-powered detection of logical duplicates
- 📊 **Code Analysis** - Complexity metrics, exports, documentation status
- 🌳 **Tree-Shaking** - Context-aware code display with intelligent collapsing
- ⚡ **Auto-Indexing** - Automatic index updates on file changes

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Sensegrep: Search` | `Ctrl+Shift+S` | Open semantic search |
| `Sensegrep: Find Similar` | `Ctrl+Shift+F` | Find code similar to selection |
| `Sensegrep: Detect Duplicates` | - | Analyze project for duplicates |
| `Sensegrep: Index Project` | - | Index/reindex project |
| `Sensegrep: Set Gemini API Key` | - | Configure API key |

## Configuration

### Embeddings Provider

By default, Sensegrep uses local embeddings (transformers.js). For better accuracy, you can use Gemini:

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Run `Sensegrep: Set Gemini API Key` or set `GEMINI_API_KEY` environment variable
3. Change `sensegrep.embeddings.provider` to `"gemini"`

### Settings

```json
{
  "sensegrep.autoIndex": true,
  "sensegrep.watchMode": true,
  "sensegrep.showCodeLens": true,
  "sensegrep.duplicateThreshold": 0.85,
  "sensegrep.embeddings.provider": "local",
  "sensegrep.embeddings.model": "BAAI/bge-small-en-v1.5"
}
```

## Requirements

- Node.js 18+
- VS Code 1.85+

## License

MIT
