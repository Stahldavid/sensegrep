export { SenseGrepTool } from "./tool/sensegrep.js"
export { Tool } from "./tool/tool.js"
export { Indexer } from "./semantic/indexer.js"
export { IndexWatcher } from "./semantic/index-watcher.js"
export { VectorStore } from "./semantic/lancedb.js"
export { Chunking } from "./semantic/chunking.js"
export { Embeddings } from "./semantic/embeddings.js"
export { DuplicateDetector } from "./semantic/duplicate-detector.js"
export { TreeShaker } from "./semantic/tree-shaker.js"
export { Instance } from "./project/instance.js"
export { Bus } from "./bus/index.js"
export { Log } from "./util/log.js"

// Configuration
export * from "./config/index.js"

// Language Support
export {
  // Types
  type LanguageSupport,
  type ChunkMetadata,
  type SemanticSymbolType,
  type SupportedLanguage,
  type LanguageCapabilities,
  type VariantInfo,
  type DetectedLanguage,
  // Registry
  getLanguageForFile,
  getLanguageById,
  getAllLanguages,
  isSupported,
  // Capabilities
  getLanguageCapabilities,
  getVariantsGroupedByLanguage,
  getAvailableVariants,
  getAvailableDecorators,
  validateVariant,
  validateDecorator,
  // Autodetection
  detectProjectLanguages,
  formatDetectedLanguages,
  // Language implementations
  TypeScriptLanguage,
  PythonLanguage,
} from "./semantic/language/index.js"
