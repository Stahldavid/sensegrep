/**
 * Language Support Types
 *
 * This module defines the core interfaces for multilingual support in Sensegrep.
 * Each language implements the LanguageSupport interface to provide:
 * - AST parsing and chunking
 * - Metadata extraction (symbolType, variant, complexity, etc.)
 * - Language-specific conventions (exports, decorators, etc.)
 */

import type { SyntaxNode } from "web-tree-sitter"

// ============================================================================
// Semantic Symbol Types (Universal)
// ============================================================================

/**
 * Universal semantic symbol types that exist across all programming languages.
 * These represent high-level concepts, not language-specific syntax.
 */
export type SemanticSymbolType =
  | "function" // Any callable (function, def, fn, func)
  | "class" // Class definition
  | "method" // Method inside a class
  | "type" // Type definition (interface, type alias, dataclass, protocol)
  | "variable" // Variable/constant declaration
  | "enum" // Enumeration
  | "module" // Namespace/module

/**
 * Variants refine a SemanticSymbolType for language-specific constructs.
 * Examples:
 * - type + interface = TypeScript interface
 * - type + dataclass = Python @dataclass
 * - method + static = static method (any language)
 */
export type SymbolVariant =
  // Function variants
  | "async"
  | "generator"
  | "arrow"
  // Class variants
  | "dataclass"
  | "abstract"
  // Method variants
  | "static"
  | "classmethod"
  | "property"
  // Type variants
  | "interface"
  | "alias"
  | "schema"
  | "protocol"
  // Variable variants
  | "constant"

// ============================================================================
// Chunk Metadata (Output of Language Support)
// ============================================================================

/**
 * Metadata extracted from a code chunk.
 * This is the output of LanguageSupport.extractMetadata()
 */
export interface ChunkMetadata {
  /** Name of the symbol (function name, class name, etc.) */
  symbolName?: string

  /** Universal semantic type */
  symbolType: SemanticSymbolType

  /** Language-specific variant (refines symbolType) */
  variant?: SymbolVariant | string

  /** Source language */
  language: SupportedLanguage

  /** Whether this symbol is public/exported */
  isExported: boolean

  /** Whether this is an async function/method */
  isAsync: boolean

  /** Whether this is a static method */
  isStatic: boolean

  /** Whether this is abstract (class or method) */
  isAbstract: boolean

  /** Decorators applied to this symbol (e.g., ["@property", "@lru_cache"]) */
  decorators: string[]

  /** Cyclomatic complexity score */
  complexity: number

  /** Whether JSDoc/docstring is present */
  hasDocumentation: boolean

  /** Parent scope name (e.g., class name for methods) */
  parentScope?: string

  /** Imported modules (comma-separated for filtering) */
  imports?: string
}

// ============================================================================
// Language Support Interface
// ============================================================================

/**
 * Supported programming languages.
 * Add new languages here as they are implemented.
 */
export type SupportedLanguage = "typescript" | "javascript" | "python" | "html"

/**
 * Variant definition with metadata for discovery and help text.
 */
export interface LanguageVariantDef {
  /** Variant name (e.g., "interface", "dataclass") */
  readonly name: string

  /** Human-readable description */
  readonly description: string

  /** Category for grouping in help text */
  readonly category: "type" | "modifier" | "decorator"
}

/**
 * Interface that each language implementation must satisfy.
 * This provides all the language-specific logic needed for:
 * - Parsing (via tree-sitter)
 * - Chunking (identifying logical boundaries)
 * - Metadata extraction (symbolType, complexity, etc.)
 */
export interface LanguageSupport {
  /** Language identifier */
  readonly id: SupportedLanguage

  /** Human-readable name (e.g., "TypeScript", "Python") */
  readonly displayName: string

  /** File extensions this language handles (e.g., [".ts", ".tsx"]) */
  readonly extensions: readonly string[]

  /** Path to tree-sitter WASM parser */
  readonly parserWasm: string

  /** Reserved words for code normalization (used by duplicate detector) */
  readonly reservedWords: ReadonlySet<string>

  /** Available variants with descriptions (for discovery/help) */
  readonly variants: readonly LanguageVariantDef[]

  /** Common decorators in this language */
  readonly decorators: readonly string[]

  // ==========================================================================
  // AST Analysis
  // ==========================================================================

  /**
   * Check if an AST node represents a chunk boundary.
   * Boundaries are top-level constructs like functions, classes, etc.
   */
  isChunkBoundary(node: SyntaxNode): boolean

  /**
   * Check if a node should be skipped during traversal.
   * Used to avoid descending into already-processed nodes.
   */
  shouldSkipNode(node: SyntaxNode): boolean

  /**
   * Extract complete metadata from an AST node.
   * This is the main workhorse that maps AST → ChunkMetadata.
   */
  extractMetadata(node: SyntaxNode, content: string, filePath: string): ChunkMetadata

  /**
   * Extract the name/identifier from a node.
   */
  extractNodeName(node: SyntaxNode): string | undefined

  // ==========================================================================
  // Semantic Analysis
  // ==========================================================================

  /**
   * Calculate cyclomatic complexity of a node.
   * Counts decision points (if, for, while, try, etc.)
   */
  calculateComplexity(node: SyntaxNode): number

  /**
   * Check if a symbol is exported/public.
   * - TypeScript: has `export` keyword
   * - Python: name doesn't start with `_`
   */
  isExported(node: SyntaxNode): boolean

  /**
   * Check if a function/method is async.
   */
  isAsync(node: SyntaxNode): boolean

  /**
   * Check if a method is static.
   */
  isStatic(node: SyntaxNode): boolean

  /**
   * Check if a class/method is abstract.
   */
  isAbstract(node: SyntaxNode): boolean

  /**
   * Extract decorators from a node.
   * Returns array of decorator strings (e.g., ["@property", "@lru_cache"])
   */
  extractDecorators(node: SyntaxNode): string[]

  /**
   * Check if a node has documentation (JSDoc, docstring, etc.)
   */
  hasDocumentation(node: SyntaxNode): boolean

  /**
   * Get the parent scope name (e.g., class name for a method).
   */
  getParentScope(node: SyntaxNode): string | undefined

  // ==========================================================================
  // Node Type Mapping
  // ==========================================================================

  /**
   * Map a SemanticSymbolType (+ optional variant) to AST node type names.
   * Used for filtering: given symbolType="function", what AST nodes match?
   */
  getNodeTypes(symbolType: SemanticSymbolType, variant?: string): readonly string[]

  /**
   * Determine the SemanticSymbolType for an AST node.
   */
  nodeToSymbolType(node: SyntaxNode): SemanticSymbolType | undefined

  /**
   * Determine the variant for an AST node (if any).
   */
  nodeToVariant(node: SyntaxNode): SymbolVariant | string | undefined
}

// ============================================================================
// Filter Types (for sensegrep tool)
// ============================================================================

/**
 * Semantic filters used by the sensegrep search tool.
 * These are language-agnostic and map to ChunkMetadata fields.
 */
export interface SemanticFilters {
  /** Universal semantic type */
  symbolType?: SemanticSymbolType

  /** Language-specific variant */
  variant?: string

  /** Filter by language */
  language?: SupportedLanguage

  /** Filter for exported/public symbols */
  isExported?: boolean

  /** Filter for async functions/methods */
  isAsync?: boolean

  /** Filter for static methods */
  isStatic?: boolean

  /** Filter for abstract classes/methods */
  isAbstract?: boolean

  /** Filter by decorator (e.g., "@property") */
  decorator?: string

  /** Minimum complexity */
  minComplexity?: number

  /** Maximum complexity */
  maxComplexity?: number

  /** Filter for documented code */
  hasDocumentation?: boolean

  /** Filter by parent scope (e.g., class name) */
  parentScope?: string
}

// ============================================================================
// Language Capabilities (for dynamic help/schema generation)
// ============================================================================

/**
 * Information about a variant, including which languages support it.
 * Used for generating dynamic help text and MCP schemas.
 */
export interface VariantInfo {
  /** Variant name */
  readonly name: string

  /** Human-readable description */
  readonly description: string

  /** Languages that support this variant */
  readonly languages: readonly SupportedLanguage[]

  /** Category for grouping */
  readonly category: "type" | "modifier" | "decorator"
}

/**
 * Aggregated capabilities across all loaded languages.
 * Used for dynamic CLI help and MCP schema generation.
 */
export interface LanguageCapabilities {
  /** All loaded languages */
  readonly languages: readonly SupportedLanguage[]

  /** Display names for loaded languages */
  readonly languageNames: readonly { id: SupportedLanguage; displayName: string }[]

  /** Universal semantic symbol types */
  readonly symbolTypes: readonly SemanticSymbolType[]

  /** All available variants with their supporting languages */
  readonly variants: readonly VariantInfo[]

  /** All available decorators across languages */
  readonly decorators: readonly string[]
}

/**
 * Variants grouped by language (for help text display)
 */
export type VariantsByLanguage = ReadonlyMap<SupportedLanguage, readonly LanguageVariantDef[]>
