/**
 * Language Support Module
 *
 * Provides multilingual support for sensegrep chunking and analysis.
 * Each language implementation follows the LanguageSupport interface.
 */

// Types
export type {
  LanguageSupport,
  LanguageChunk,
  BuiltinLanguage,
  ChunkMetadata,
  SemanticSymbolType,
  SymbolVariant,
  SupportedLanguage,
  LanguageVariantDef,
  LanguageCapabilities,
  VariantInfo,
  SemanticKindInfo,
} from "./types.js"

// Registry
export {
  registerLanguage,
  unregisterLanguage,
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
  getAvailableSemanticKinds,
  expandSemanticKindFilter,
  validateVariant,
  validateDecorator,
  validateSymbolType,
} from "./capabilities.js"

// Autodetection
export {
  detectProjectLanguages,
  formatDetectedLanguages,
  type DetectedLanguage,
} from "./autodetect.js"
export { loadLanguagePlugins, clearLoadedLanguagePlugins } from "./plugin.js"

// Language Implementations
export { TypeScriptLanguage, JavaScriptLanguage, tsParser, tsxParser } from "./typescript.js"
export { PythonLanguage, pythonParser, chunk as chunkPython } from "./python.js"
export { JavaLanguage, javaParser, chunk as chunkJava } from "./java.js"
export { VueLanguage, vueParser, chunk as chunkVue, extractVueScriptBlocks } from "./vue.js"

// ============================================================================
// Auto-register languages on module load
// ============================================================================
import { registerLanguage } from "./registry.js"
import { TypeScriptLanguage, JavaScriptLanguage } from "./typescript.js"
import { PythonLanguage } from "./python.js"
import { JavaLanguage } from "./java.js"
import { VueLanguage } from "./vue.js"
import { chunk as chunkPython } from "./python.js"
import { chunk as chunkJava } from "./java.js"
import { chunk as chunkVue } from "./vue.js"

// Register all built-in languages
registerLanguage(TypeScriptLanguage)
registerLanguage(JavaScriptLanguage)
registerLanguage({ ...PythonLanguage, chunk: chunkPython })
registerLanguage({ ...JavaLanguage, chunk: chunkJava })
registerLanguage({ ...VueLanguage, chunk: chunkVue })
