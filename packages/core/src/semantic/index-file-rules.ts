import path from "path"

export type IndexFileKind = "code" | "doc" | "config"

const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".vue",
  ".svelte",
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
])

export function isIndexableFilePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return INDEXABLE_EXTENSIONS.has(ext)
}

export function getFileKind(filePath: string): IndexFileKind {
  const ext = path.extname(filePath).toLowerCase()
  const baseName = path.basename(filePath).toLowerCase()

  if (
    ext === ".json" ||
    ext === ".yaml" ||
    ext === ".yml" ||
    ext === ".toml" ||
    ext === ".ini" ||
    ext === ".conf" ||
    baseName.startsWith("tsconfig") ||
    baseName.startsWith("jest.config") ||
    baseName.startsWith("vitest.config") ||
    baseName.startsWith("webpack") ||
    baseName.startsWith("rollup") ||
    baseName.startsWith("babel") ||
    baseName.startsWith("eslint") ||
    baseName.startsWith("prettier") ||
    baseName === "package.json" ||
    baseName === "package-lock.json"
  ) {
    return "config"
  }

  if (
    ext === ".md" ||
    ext === ".mdx" ||
    ext === ".txt" ||
    ext === ".rst" ||
    baseName === "changelog" ||
    baseName === "readme" ||
    baseName.startsWith("readme.") ||
    baseName.startsWith("changelog.") ||
    baseName.startsWith("contributing.") ||
    baseName.startsWith("license.")
  ) {
    return "doc"
  }

  return "code"
}

export function shouldIndexFile(
  filePath: string,
  options: { includeDocs?: boolean; includeConfig?: boolean },
): boolean {
  if (!isIndexableFilePath(filePath)) return false

  const fileKind = getFileKind(filePath)
  if (fileKind === "doc" && !options.includeDocs) return false
  if (fileKind === "config" && !options.includeConfig) return false

  return true
}

export function isProbablyMinifiedOrGenerated(filePath: string, content: string): boolean {
  if (/\.(min)\.(js|mjs|cjs|css)$/i.test(filePath)) return true

  const lines = content.split("\n")
  const lineCount = Math.max(1, lines.length)
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const averageLineLength = Math.ceil(content.length / lineCount)
  const veryLongLineCount = lines.filter((line) => line.length >= 10_000).length

  return (
    content.length >= 50_000 &&
    (lineCount <= 5 || maxLineLength >= 20_000 || (averageLineLength >= 2_000 && veryLongLineCount >= 1))
  )
}
