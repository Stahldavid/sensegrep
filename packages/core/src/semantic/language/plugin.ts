import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadConfig } from "../../config/loader.js"
import { registerLanguage } from "./registry.js"
import type { LanguageSupport } from "./types.js"

const loaded = new Set<string>()

function looksLikeLanguage(value: unknown): value is LanguageSupport {
  const candidate = value as Partial<LanguageSupport> | undefined
  return !!candidate && typeof candidate.id === "string" && typeof candidate.displayName === "string" &&
    Array.isArray(candidate.extensions) && typeof candidate.extractMetadata === "function"
}

function pluginSpecifier(rootDir: string, specifier: string): string {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return pathToFileURL(path.resolve(rootDir, specifier)).href
  }
  return specifier
}

export async function loadLanguagePlugins(rootDir: string, explicit?: string[]): Promise<string[]> {
  const configured = explicit ?? [
    ...(loadConfig(rootDir).languagePlugins ?? []),
    ...(process.env.SENSEGREP_LANGUAGE_PLUGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? []),
  ]
  const registered: string[] = []
  for (const raw of configured) {
    const specifier = pluginSpecifier(rootDir, raw)
    if (loaded.has(specifier)) continue
    const module = await import(specifier)
    if (typeof module.register === "function") {
      await module.register({ registerLanguage })
    } else {
      const candidates = Array.isArray(module.languages)
        ? module.languages
        : [module.language, module.default].filter(Boolean)
      if (candidates.length === 0 || candidates.some((candidate: unknown) => !looksLikeLanguage(candidate))) {
        throw new Error(`Language plugin ${raw} must export default/language, languages[], or register().`)
      }
      for (const language of candidates as LanguageSupport[]) {
        registerLanguage(language)
        registered.push(language.id)
      }
    }
    loaded.add(specifier)
  }
  return registered
}

export function clearLoadedLanguagePlugins(): void {
  loaded.clear()
}
