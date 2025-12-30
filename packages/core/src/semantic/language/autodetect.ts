/**
 * Language Autodetection
 *
 * Detects which programming languages are used in a project
 * by scanning file extensions.
 */

import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { SupportedLanguage } from "./types.js"
import { getAllLanguages } from "./registry.js"

// ============================================================================
// Types
// ============================================================================

export interface DetectedLanguage {
  /** Language identifier */
  language: SupportedLanguage
  /** Number of files found */
  fileCount: number
  /** Percentage of total files */
  percentage: number
}

// ============================================================================
// Autodetection
// ============================================================================

/**
 * Detect which programming languages are used in a project.
 * Returns languages sorted by file count (most common first).
 */
export async function detectProjectLanguages(
  rootDir: string
): Promise<DetectedLanguage[]> {
  // Collect file extensions
  const extensionCounts = await collectExtensions(rootDir)

  // Map extensions to languages
  const languageCounts = new Map<SupportedLanguage, number>()
  let totalFiles = 0

  for (const [ext, count] of extensionCounts) {
    const lang = getLanguageForExtension(ext)
    if (lang) {
      languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + count)
      totalFiles += count
    }
  }

  // Convert to array sorted by file count
  const result: DetectedLanguage[] = []
  for (const [language, fileCount] of languageCounts) {
    result.push({
      language,
      fileCount,
      percentage: totalFiles > 0 ? (fileCount / totalFiles) * 100 : 0,
    })
  }

  return result.sort((a, b) => b.fileCount - a.fileCount)
}

/**
 * Get the language for a file extension.
 */
function getLanguageForExtension(ext: string): SupportedLanguage | undefined {
  for (const lang of getAllLanguages()) {
    if (lang.extensions.includes(ext)) {
      return lang.id
    }
  }
  return undefined
}

/**
 * Collect file extensions and their counts from a directory.
 * Uses ripgrep for speed if available, falls back to find or fs.
 */
async function collectExtensions(
  rootDir: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  try {
    // Try ripgrep first (fastest)
    const output = execSync(`rg --files "${rootDir}" 2>/dev/null`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: 30000, // 30s timeout
    })

    for (const line of output.split("\n")) {
      if (!line) continue
      const ext = path.extname(line).toLowerCase()
      if (ext) {
        counts.set(ext, (counts.get(ext) ?? 0) + 1)
      }
    }
  } catch {
    // Fallback: use recursive fs scan
    await scanDirectory(rootDir, counts, 0)
  }

  return counts
}

/**
 * Recursively scan a directory for file extensions.
 * Respects common ignore patterns.
 */
async function scanDirectory(
  dir: string,
  counts: Map<string, number>,
  depth: number
): Promise<void> {
  // Limit depth to prevent infinite loops
  if (depth > 20) return

  // Skip common ignored directories
  const basename = path.basename(dir)
  if (IGNORED_DIRS.has(basename)) return

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, counts, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (ext) {
          counts.set(ext, (counts.get(ext) ?? 0) + 1)
        }
      }
    }
  } catch {
    // Ignore permission errors, etc.
  }
}

/** Directories to skip during scanning */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "venv",
  ".venv",
  "env",
  ".env",
  "vendor",
  "target",
  ".idea",
  ".vscode",
  "coverage",
  ".nyc_output",
])

/**
 * Format detected languages for display.
 */
export function formatDetectedLanguages(
  detected: DetectedLanguage[]
): string {
  if (detected.length === 0) {
    return "No supported languages detected."
  }

  const lines = ["Detected languages:"]
  for (const d of detected) {
    lines.push(
      `  ${d.language}: ${d.fileCount} file${d.fileCount === 1 ? "" : "s"} (${d.percentage.toFixed(1)}%)`
    )
  }
  lines.push("")
  lines.push(
    `Recommendation: sensegrep index --languages ${detected.map((d) => d.language).join(",")}`
  )

  return lines.join("\n")
}
