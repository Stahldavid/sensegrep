export { SenseGrepTool } from "./tool/sensegrep.js"
export { SenseGrepContextTool, SenseGrepContextParametersSchema } from "./tool/sensegrep-context.js"
export { SenseGrepLiteralTool, SenseGrepLiteralParametersSchema } from "./tool/sensegrep-literal.js"
export { SenseGrepParametersSchema, CommonSearchShape } from "./tool/search-schema.js"
export { SurveyParametersSchema } from "./tool/sensegrep-survey.js"
export { ClusterParametersSchema } from "./tool/sensegrep-cluster.js"
export { SenseGrepSurveyTool } from "./tool/sensegrep-survey.js"
export { SenseGrepClusterTool } from "./tool/sensegrep-cluster.js"
export { Tool } from "./tool/tool.js"
export { Indexer } from "./semantic/indexer.js"
export { IndexWatcher } from "./semantic/index-watcher.js"
export { VectorStore } from "./semantic/lancedb.js"
export { Chunking } from "./semantic/chunking.js"
export { Embeddings } from "./semantic/embeddings.js"
export { EmbeddingBenchmark } from "./semantic/embedding-benchmark.js"
export { DuplicateDetector } from "./semantic/duplicate-detector.js"
export { CodeGraph } from "./semantic/code-graph.js"
export { TreeShaker } from "./semantic/tree-shaker.js"
export { Instance } from "./project/instance.js"
export { GitScope } from "./project/git.js"
export { Bus } from "./bus/index.js"
export { Log } from "./util/log.js"

// Configuration
export * from "./config/index.js"

// Language Support
export {
  // Types
  type LanguageSupport,
  type LanguageChunk,
  type BuiltinLanguage,
  type ChunkMetadata,
  type SemanticSymbolType,
  type SupportedLanguage,
  type LanguageCapabilities,
  type VariantInfo,
  type SemanticKindInfo,
  type DetectedLanguage,
  // Registry
  getLanguageForFile,
  registerLanguage,
  unregisterLanguage,
  getLanguageById,
  getAllLanguages,
  isSupported,
  // Capabilities
  getLanguageCapabilities,
  getVariantsGroupedByLanguage,
  getAvailableVariants,
  getAvailableDecorators,
  getAvailableSemanticKinds,
  expandSemanticKindFilter,
  validateVariant,
  validateDecorator,
  // Autodetection
  detectProjectLanguages,
  loadLanguagePlugins,
  clearLoadedLanguagePlugins,
  formatDetectedLanguages,
  // Language implementations
  TypeScriptLanguage,
  PythonLanguage,
  JavaLanguage,
  VueLanguage,
} from "./semantic/language/index.js"
