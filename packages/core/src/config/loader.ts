/**
 * Configuration Loader
 *
 * Loads and resolves sensegrep configuration from various sources.
 * Priority: CLI flags > Environment variables > Config file > Autodetection
 */

import * as fs from "node:fs"
import * as path from "node:path"
import type { SensegrepConfig, ResolvedConfig, ConfigResolutionOptions } from "./types.js"
import type { SupportedLanguage } from "../semantic/language/types.js"
import { detectProjectLanguages } from "../semantic/language/autodetect.js"
import { isSupported } from "../semantic/language/registry.js"

// ============================================================================
// Constants
// ============================================================================

/** Config file names in order of priority */
const CONFIG_FILES = [".sensegreprc.json", "sensegrep.config.json"] as const

/** Environment variable for languages */
const ENV_LANGUAGES = "SENSEGREP_LANGUAGES"

/** Default language if nothing is detected */
const DEFAULT_LANGUAGE: SupportedLanguage = "typescript"

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Load configuration from a config file in the given directory.
 * Returns empty config if no file is found.
 */
export function loadConfig(rootDir: string): SensegrepConfig {
  for (const filename of CONFIG_FILES) {
    const configPath = path.join(rootDir, filename)
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8")
        return JSON.parse(content) as SensegrepConfig
      } catch (error) {
        console.warn(`Warning: Failed to parse ${filename}:`, error)
      }
    }
  }
  return {}
}

/**
 * Resolve configuration with all sources considered.
 * 
 * Priority:
 * 1. CLI flag (languagesOverride)
 * 2. Environment variable (SENSEGREP_LANGUAGES)
 * 3. Config file
 * 4. Autodetection
 */
export async function resolveConfig(
  rootDir: string,
  options: ConfigResolutionOptions = {}
): Promise<ResolvedConfig> {
  // Load config from file if not provided
  const config = options.config ?? loadConfig(rootDir)

  // Determine languages with priority
  let languages = await resolveLanguages(rootDir, config, options)

  // Filter to only supported languages
  languages = languages.filter(isSupported)

  // Fallback to default if nothing detected
  if (languages.length === 0) {
    languages = [DEFAULT_LANGUAGE]
  }

  return {
    ...config,
    languages,
  }
}

/**
 * Resolve languages from various sources.
 */
async function resolveLanguages(
  rootDir: string,
  config: SensegrepConfig,
  options: ConfigResolutionOptions
): Promise<SupportedLanguage[]> {
  // Priority 1: CLI flag override
  if (options.languagesOverride) {
    if (options.languagesOverride === "auto") {
      return await autodetectLanguages(rootDir)
    }
    return options.languagesOverride
  }

  // Priority 2: Environment variable
  if (options.useEnv !== false && process.env[ENV_LANGUAGES]) {
    const envLangs = parseLanguagesString(process.env[ENV_LANGUAGES])
    if (envLangs.length > 0) {
      return envLangs
    }
  }

  // Priority 3: Config file
  if (config.languages) {
    if (config.languages === "auto") {
      return await autodetectLanguages(rootDir)
    }
    return config.languages
  }

  // Priority 4: Autodetection (default)
  return await autodetectLanguages(rootDir)
}

/**
 * Autodetect languages from project files.
 */
async function autodetectLanguages(rootDir: string): Promise<SupportedLanguage[]> {
  const detected = await detectProjectLanguages(rootDir)
  return detected.map((d) => d.language)
}

/**
 * Parse a comma-separated languages string.
 */
function parseLanguagesString(str: string): SupportedLanguage[] {
  return str
    .split(",")
    .map((s) => s.trim().toLowerCase() as SupportedLanguage)
    .filter((s) => s.length > 0)
}

// ============================================================================
// Config File Management
// ============================================================================

/**
 * Write a config file to the given directory.
 */
export function writeConfig(
  rootDir: string,
  config: SensegrepConfig,
  filename: string = CONFIG_FILES[0]
): void {
  const configPath = path.join(rootDir, filename)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

/**
 * Check if a config file exists in the given directory.
 */
export function hasConfigFile(rootDir: string): boolean {
  return CONFIG_FILES.some((f) => fs.existsSync(path.join(rootDir, f)))
}

/**
 * Get the path to the config file if it exists.
 */
export function getConfigFilePath(rootDir: string): string | undefined {
  for (const filename of CONFIG_FILES) {
    const configPath = path.join(rootDir, filename)
    if (fs.existsSync(configPath)) {
      return configPath
    }
  }
  return undefined
}
