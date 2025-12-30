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
  LanguageVariantDef,
  LanguageCapabilities,
  VariantInfo,
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

// Capabilities (dynamic discovery)
export {
  getLanguageCapabilities,
  getVariantsGroupedByLanguage,
  getAvailableVariants,
  getAvailableDecorators,
  validateVariant,
  validateDecorator,
} from "./capabilities.js"

// Autodetection
export {
  detectProjectLanguages,
  formatDetectedLanguages,
  type DetectedLanguage,
} from "./autodetect.js"

// Language Implementations
export { TypeScriptLanguage, JavaScriptLanguage, tsParser, tsxParser } from "./typescript.js"
export { PythonLanguage, pythonParser, chunk as chunkPython } from "./python.js"

// ============================================================================
// Auto-register languages on module load
// ============================================================================
import { registerLanguage } from "./registry.js"
import { TypeScriptLanguage, JavaScriptLanguage } from "./typescript.js"
import { PythonLanguage } from "./python.js"

// Register all built-in languages
registerLanguage(TypeScriptLanguage)
registerLanguage(JavaScriptLanguage)
registerLanguage(PythonLanguage)
