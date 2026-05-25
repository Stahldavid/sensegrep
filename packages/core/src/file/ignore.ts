import picomatch from "picomatch"

export namespace FileIgnore {
  function normalize(filepath: string): string {
    return filepath.replace(/\\/g, "/")
  }

  const FOLDERS = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    ".opencode",
    ".tmp",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",

    // Generated frontend assets / sourcemaps
    "**/*.min.js",
    "**/*.min.mjs",
    "**/*.min.cjs",
    "**/*.min.css",
    "**/*.map",
  ]

  type GlobMatcher = (path: string) => boolean
  export function createGlobMatcher(pattern: string): GlobMatcher {
    const normalizedPattern = normalize(pattern)
    return picomatch(normalizedPattern, {
      dot: true,
      basename: !normalizedPattern.includes("/"),
    })
  }

  export function createGlobMatchers(patterns: string[]): GlobMatcher[] {
    return patterns.map((pattern) => createGlobMatcher(pattern))
  }

  const FILE_GLOBS: GlobMatcher[] = FILES.map((p) => createGlobMatcher(p))

  export const PATTERNS = [...FILES, ...FOLDERS]

  export function match(
    filepath: string,
    opts?: {
      extra?: GlobMatcher[]
      whitelist?: GlobMatcher[]
    },
  ) {
    const normalized = normalize(filepath)

    for (const glob of opts?.whitelist || []) {
      if (glob(normalized)) return false
    }

    const parts = normalized.split(/[\\/]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    const extra = opts?.extra || []
    for (const glob of [...FILE_GLOBS, ...extra]) {
      if (glob(normalized)) return true
    }

    return false
  }
}
