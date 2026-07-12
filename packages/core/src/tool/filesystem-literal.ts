import path from "node:path"
import { spawn } from "node:child_process"
import { once } from "node:events"

export type FilesystemLiteralOptions = {
  rootDir: string
  query: string
  regex?: boolean
  caseSensitive?: boolean
  include?: string
  exclude?: string
  limit?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

function canonicalFile(rootDir: string, file: string): string {
  const absolute = path.isAbsolute(file) ? file : path.resolve(rootDir, file)
  return path.relative(rootDir, absolute).replace(/\\/g, "/")
}

type RawMatch = {
  path: { text: string }
  lines: { text: string }
  line_number: number
}

async function searchWithPathRipgrep(options: FilesystemLiteralOptions, glob: string[]): Promise<RawMatch[]> {
  const args = ["--json", "--follow", "--hidden", "--glob=!.git/*"]
  for (const value of glob) args.push(`--glob=${value}`)
  if (options.regex !== true) args.push("--fixed-strings")
  if (options.caseSensitive === false) args.push("--ignore-case")
  args.push("--", options.query)
  const proc = spawn("rg", args, {
    cwd: options.rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    signal: options.signal,
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  proc.stdout?.on("data", (chunk) => { stdout += chunk.toString() })
  proc.stderr?.on("data", (chunk) => { stderr += chunk.toString() })
  const [code] = await once(proc, "close") as [number | null]
  if (code === 1) return []
  if (code !== 0) throw new Error(`ripgrep failed with code ${code}: ${stderr.trim()}`)
  return stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
    const parsed = JSON.parse(line)
    return parsed.type === "match" ? [parsed.data as RawMatch] : []
  })
}

async function searchFilesystem(options: FilesystemLiteralOptions, glob: string[]): Promise<RawMatch[]> {
  try {
    return await searchWithPathRipgrep(options, glob)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const { Ripgrep } = await import("../file/ripgrep.js")
    return Ripgrep.search({
      cwd: options.rootDir,
      pattern: options.query,
      glob: glob.length > 0 ? glob : undefined,
      fixedStrings: options.regex !== true,
      caseSensitive: options.caseSensitive !== false,
      signal: options.signal,
    })
  }
}

export async function runFilesystemLiteral(options: FilesystemLiteralOptions) {
  const glob = [
    ...(options.include ? [options.include] : []),
    ...(options.exclude ? [`!${options.exclude}`] : []),
  ]
  const rawMatches = await searchFilesystem(options, glob)
  const normalized = rawMatches.map((match) => ({
    file: canonicalFile(options.rootDir, match.path.text),
    line: match.line_number,
    text: match.lines.text.replace(/\r?\n$/, "").trim(),
  }))
  const matches = options.limit ? normalized.slice(0, options.limit) : normalized
  const truncated = matches.length < normalized.length
  const outputBytes = matches.reduce(
    (sum, match) => sum + Buffer.byteLength(`${match.file}:${match.line}:${match.text}\n`),
    0,
  )

  return {
    schemaVersion: 1,
    command: "literal",
    status: "complete",
    title: options.query,
    metadata: {
      indexed: false,
      totalMatches: normalized.length,
      returnedMatches: matches.length,
      exhaustive: !truncated,
      truncated,
      files: new Set(normalized.map((match) => match.file)).size,
      outputBytes,
    },
    index: { checked: false },
    retrieval: {
      requestedMode: "literal",
      actualMode: "literal",
      vectorUsed: false,
      exhaustive: !truncated,
      exhaustiveWithin: "ripgrep-visible-filesystem",
      universe: {
        source: "ripgrep-visible-filesystem",
        matchedFiles: new Set(normalized.map((match) => match.file)).size,
      },
    },
    warnings: [] as string[],
    budget: { maxOutputBytes: options.maxOutputBytes, outputBytes },
    matches,
    output: matches.length > 0
      ? matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n")
      : "No literal matches found.",
  }
}
