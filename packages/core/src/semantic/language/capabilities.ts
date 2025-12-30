/**
 * Language Capabilities Discovery
 *
 * Provides functions to discover available languages, variants, and decorators.
 * Used by CLI for dynamic help and MCP for dynamic schema generation.
 */

import { getAllLanguages, getLanguageById } from "./registry.js"
import type {
  LanguageCapabilities,
  VariantInfo,
  SupportedLanguage,
  SemanticSymbolType,
} from "./types.js"

// ============================================================================
// Constants
// ============================================================================

/** Universal semantic symbol types that exist across all languages */
const SEMANTIC_SYMBOL_TYPES: readonly SemanticSymbolType[] = [
  "function",
  "class",
  "method",
  "type",
  "variable",
  "enum",
  "module",
] as const

// ============================================================================
// Capabilities Discovery
// ============================================================================

/**
 * Get aggregated capabilities from all registered languages.
 * Used by CLI and MCP to generate dynamic help and schemas.
 */
export function getLanguageCapabilities(): LanguageCapabilities {
  const languages = getAllLanguages()

  // Aggregate variants by name, tracking which languages support each
  const variantMap = new Map<string, VariantInfo>()
  const decorators = new Set<string>()

  for (const lang of languages) {
    // Collect variants
    for (const v of lang.variants) {
      const existing = variantMap.get(v.name)
      if (existing) {
        variantMap.set(v.name, {
          ...existing,
          languages: [...existing.languages, lang.id],
        })
      } else {
        variantMap.set(v.name, {
          name: v.name,
          description: v.description,
          category: v.category,
          languages: [lang.id],
        })
      }
    }

    // Collect decorators
    for (const d of lang.decorators) {
      decorators.add(d)
    }
  }

  return {
    languages: languages.map((l) => l.id),
    languageNames: languages.map((l) => ({ id: l.id, displayName: l.displayName })),
    symbolTypes: SEMANTIC_SYMBOL_TYPES,
    variants: [...variantMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    decorators: [...decorators].sort(),
  }
}

/**
 * Get variants grouped by language.
 * Useful for generating language-specific documentation.
 */
export function getVariantsGroupedByLanguage(): Map<
  SupportedLanguage,
  VariantInfo[]
> {
  const result = new Map<SupportedLanguage, VariantInfo[]>()

  for (const lang of getAllLanguages()) {
    result.set(
      lang.id,
      lang.variants.map((v) => ({
        name: v.name,
        description: v.description,
        category: v.category,
        languages: [lang.id],
      }))
    )
  }

  return result
}

/**
 * Get available variants for a specific language or all languages.
 */
export function getAvailableVariants(
  language?: SupportedLanguage
): VariantInfo[] {
  if (language) {
    const lang = getLanguageById(language)
    if (!lang) return []
    return lang.variants.map((v) => ({
      name: v.name,
      description: v.description,
      category: v.category,
      languages: [language],
    }))
  }

  return [...getLanguageCapabilities().variants]
}

/**
 * Get available decorators for a specific language or all languages.
 */
export function getAvailableDecorators(language?: SupportedLanguage): string[] {
  if (language) {
    const lang = getLanguageById(language)
    return lang ? [...lang.decorators] : []
  }

  return [...getLanguageCapabilities().decorators]
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Find the closest matching string using Levenshtein distance.
 */
function findClosestMatch(
  input: string,
  candidates: string[]
): string | undefined {
  if (candidates.length === 0) return undefined

  let minDistance = Infinity
  let closest: string | undefined

  for (const candidate of candidates) {
    const distance = levenshteinDistance(
      input.toLowerCase(),
      candidate.toLowerCase()
    )
    if (distance < minDistance) {
      minDistance = distance
      closest = candidate
    }
  }

  // Only suggest if reasonably close (less than half the input length)
  return minDistance <= Math.ceil(input.length / 2) ? closest : undefined
}

/**
 * Simple Levenshtein distance implementation.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

export interface ValidationResult {
  valid: boolean
  error?: string
  suggestion?: string
}

/**
 * Validate a variant value against available variants.
 */
export function validateVariant(
  variant: string,
  language?: SupportedLanguage
): ValidationResult {
  const validVariants = getAvailableVariants(language)
  const variantNames = validVariants.map((v) => v.name)

  if (variantNames.includes(variant)) {
    return { valid: true }
  }

  const suggestion = findClosestMatch(variant, variantNames)
  const langContext = language ? ` for language "${language}"` : ""

  return {
    valid: false,
    error: `Invalid variant "${variant}"${langContext}. Available: ${variantNames.join(", ")}`,
    suggestion,
  }
}

/**
 * Validate a decorator value against available decorators.
 */
export function validateDecorator(
  decorator: string,
  language?: SupportedLanguage
): ValidationResult {
  const validDecorators = getAvailableDecorators(language)

  if (validDecorators.includes(decorator)) {
    return { valid: true }
  }

  const suggestion = findClosestMatch(decorator, validDecorators)
  const langContext = language ? ` for language "${language}"` : ""

  return {
    valid: false,
    error: `Invalid decorator "${decorator}"${langContext}. Available: ${validDecorators.join(", ")}`,
    suggestion,
  }
}

/**
 * Validate a symbol type value.
 */
export function validateSymbolType(symbolType: string): ValidationResult {
  if (SEMANTIC_SYMBOL_TYPES.includes(symbolType as SemanticSymbolType)) {
    return { valid: true }
  }

  const suggestion = findClosestMatch(symbolType, [...SEMANTIC_SYMBOL_TYPES])

  return {
    valid: false,
    error: `Invalid symbolType "${symbolType}". Available: ${SEMANTIC_SYMBOL_TYPES.join(", ")}`,
    suggestion,
  }
}
