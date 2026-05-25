import { loadConfig } from "../config/loader.js"
import { FileIgnore } from "../file/ignore.js"

type GlobMatcher = ReturnType<typeof FileIgnore.createGlobMatcher>

type ProjectIndexFilter = {
  includeMatchers: GlobMatcher[]
  excludeMatchers: GlobMatcher[]
}

const cache = new Map<string, ProjectIndexFilter>()

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function getProjectIndexFilter(rootDir: string): ProjectIndexFilter {
  const existing = cache.get(rootDir)
  if (existing) return existing

  const config = loadConfig(rootDir)
  const filter = {
    includeMatchers: FileIgnore.createGlobMatchers(config.index?.include ?? []),
    excludeMatchers: FileIgnore.createGlobMatchers(config.index?.exclude ?? []),
  }
  cache.set(rootDir, filter)
  return filter
}

export function clearProjectIndexFilterCache(rootDir?: string): void {
  if (rootDir) {
    cache.delete(rootDir)
    return
  }
  cache.clear()
}

export function shouldIgnoreIndexedFile(rootDir: string, filePath: string): boolean {
  const normalized = normalize(filePath)
  const filter = getProjectIndexFilter(rootDir)

  if (filter.includeMatchers.length > 0 && !filter.includeMatchers.some((matcher) => matcher(normalized))) {
    return true
  }

  return FileIgnore.match(normalized, {
    extra: filter.excludeMatchers,
  })
}
