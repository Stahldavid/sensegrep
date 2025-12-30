/**
 * Configuration Module
 *
 * Exports configuration types and utilities.
 */

export type {
  SensegrepConfig,
  ResolvedConfig,
  ConfigResolutionOptions,
} from "./types.js"

export {
  loadConfig,
  resolveConfig,
  writeConfig,
  hasConfigFile,
  getConfigFilePath,
} from "./loader.js"
