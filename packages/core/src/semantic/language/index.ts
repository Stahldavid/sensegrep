/**
 * Language Support Module
 *
 * Provides multilingual support for sensegrep chunking and analysis.
 * Each language implementation follows the LanguageSupport interface.
 */

// Types
export type {
  LanguageSupport,
  ChunkMetadata,
  SemanticSymbolType,
  SymbolVariant,
  SupportedLanguage,
} from "./types.js"

// Registry
export {
  registerLanguage,
  getLanguageForFile,
  getLanguageById,
  getSupportedExtensions,
  getAllLanguages,
  isSupported,
} from "./registry.js"

// Language Implementations
export { TypeScriptLanguage, JavaScriptLanguage, tsParser, tsxParser } from "./typescript.js"
export { PythonLanguage, pythonParser, chunk as chunkPython } from "./python.js"
