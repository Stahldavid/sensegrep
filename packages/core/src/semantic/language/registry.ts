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
export function registerLanguage(language: LanguageSupport, options: { replace?: boolean } = {}): () => void {
  if (!/^[a-z][a-z0-9_-]*$/i.test(language.id)) throw new Error(`Invalid language id: ${language.id}`)
  if (language.extensions.length === 0) throw new Error(`Language ${language.id} must declare at least one extension.`)
  const existing = languageById.get(language.id)
  if (existing && existing !== language && !options.replace) {
    throw new Error(`Language ${language.id} is already registered.`)
  }
  if (existing) unregisterLanguage(language.id)
  languageById.set(language.id, language)

  for (const ext of language.extensions) {
    const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    const owner = languageByExtension.get(normalized)
    if (owner && owner.id !== language.id && !options.replace) {
      languageById.delete(language.id)
      throw new Error(`Extension ${normalized} is already registered by ${owner.id}.`)
    }
    languageByExtension.set(normalized, language)
  }
  return () => unregisterLanguage(language.id)
}

export function unregisterLanguage(id: SupportedLanguage): boolean {
  const language = languageById.get(id)
  if (!language) return false
  languageById.delete(id)
  for (const [extension, owner] of languageByExtension) {
    if (owner.id === id) languageByExtension.delete(extension)
  }
  return true
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
