/**
 * Configuration Types
 *
 * Types for sensegrep configuration files and resolved config.
 */

import type { SupportedLanguage } from "../semantic/language/types.js"

// ============================================================================
// Config File Types
// ============================================================================

/**
 * Configuration file schema (.sensegreprc.json or sensegrep.config.json)
 */
export interface SensegrepConfig {
  /**
   * Languages to use for indexing.
   * - Array of language IDs: ["typescript", "python"]
   * - "auto": Autodetect from project files
   * - undefined: Defaults to "auto"
   */
  languages?: SupportedLanguage[] | "auto"

  /**
   * Embedding configuration
   */
  embeddings?: {
    /** Model name for local embeddings */
    model?: string
    /** Embedding dimensions */
    dimensions?: number
    /** Embedding provider */
    provider?: "local" | "gemini"
    /** Device for inference */
    device?: "cpu" | "cuda" | "webgpu" | "wasm"
  }

  /**
   * Indexing configuration
   */
  index?: {
    /** Glob patterns to exclude */
    exclude?: string[]
    /** Glob patterns to include (whitelist) */
    include?: string[]
  }

  /**
   * Duplicate detection configuration
   */
  duplicates?: {
    /** Enable cross-language duplicate detection (default: false) */
    crossLanguage?: boolean
    /** Similarity threshold (default: 0.85) */
    threshold?: number
  }
}

/**
 * Resolved configuration with all values determined.
 * After resolution, languages is always an array (never "auto").
 */
export interface ResolvedConfig extends Omit<SensegrepConfig, "languages"> {
  /** Resolved languages (always an array after resolution) */
  languages: SupportedLanguage[]
}

// ============================================================================
// Config Resolution Options
// ============================================================================

/**
 * Options for resolving configuration.
 */
export interface ConfigResolutionOptions {
  /** Pre-loaded config (skips file loading) */
  config?: SensegrepConfig
  /** Override languages from CLI flag */
  languagesOverride?: SupportedLanguage[] | "auto"
  /** Whether to check environment variables */
  useEnv?: boolean
}
