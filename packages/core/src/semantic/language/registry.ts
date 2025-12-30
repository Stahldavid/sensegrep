/**
 * Language Registry
 *
 * Central registry for language support implementations.
 * Provides lookup by language ID or file extension.
 */

import path from "path"
import type { LanguageSupport, SupportedLanguage } from "./types.js"

// ============================================================================
// Registry State
// ============================================================================

const languageById = new Map<SupportedLanguage, LanguageSupport>()
const languageByExtension = new Map<string, LanguageSupport>()

// ============================================================================
// Registration API
// ============================================================================

/**
 * Register a language support implementation.
 * This should be called once per language during module initialization.
 */
export function registerLanguage(language: LanguageSupport): void {
  languageById.set(language.id, language)

  for (const ext of language.extensions) {
    languageByExtension.set(ext.toLowerCase(), language)
  }
}

// ============================================================================
// Lookup API
// ============================================================================

/**
 * Get language support by language ID.
 */
export function getLanguageById(id: SupportedLanguage): LanguageSupport | undefined {
  return languageById.get(id)
}

/**
 * Get language support for a file based on its extension.
 */
export function getLanguageForFile(filePath: string): LanguageSupport | undefined {
  const ext = path.extname(filePath).toLowerCase()
  return languageByExtension.get(ext)
}

/**
 * Check if a file is supported by any registered language.
 */
export function isSupported(filePath: string): boolean {
  return getLanguageForFile(filePath) !== undefined
}

/**
 * Get all registered languages.
 */
export function getAllLanguages(): readonly LanguageSupport[] {
  return Array.from(languageById.values())
}

/**
 * Get all supported file extensions.
 */
export function getSupportedExtensions(): readonly string[] {
  return Array.from(languageByExtension.keys())
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detect language from file path.
 * Returns the language ID or undefined if not supported.
 */
export function detectLanguage(filePath: string): SupportedLanguage | undefined {
  const language = getLanguageForFile(filePath)
  return language?.id
}
