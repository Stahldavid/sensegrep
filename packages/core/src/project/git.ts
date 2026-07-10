function normalizeFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean)
}

async function runGit(rootDir: string, args: string[], signal?: AbortSignal): Promise<string[]> {
  try {
    const { execFile } = await import("node:child_process")
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-C", rootDir, ...args], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        signal,
      }, (error, output) => {
        if (error) reject(error)
        else resolve(output)
      })
    })
    return normalizeFiles(stdout)
  } catch (error: any) {
    if (error?.code === "ABORT_ERR") throw error
    const message = String(error?.stderr || error?.message || error).trim()
    throw new Error(`Unable to read Git changes in ${rootDir}: ${message}`)
  }
}

export namespace GitScope {
  export async function changedFiles(rootDir: string, options: { base?: string; signal?: AbortSignal } = {}): Promise<string[]> {
    const outputs = await Promise.all([
      options.base
        ? runGit(rootDir, ["diff", "--name-only", "--diff-filter=ACMR", `${options.base}...HEAD`], options.signal)
        : Promise.resolve([]),
      runGit(rootDir, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], options.signal),
      runGit(rootDir, ["ls-files", "--others", "--exclude-standard"], options.signal),
    ])
    return [...new Set(outputs.flat())].sort()
  }
}
