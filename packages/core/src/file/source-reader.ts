import fs from "node:fs/promises"
import { constants, type Stats } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

export class SourceReadError extends Error {
  constructor(readonly code: "outside-root" | "unsafe-source" | "source-too-large" | "source-changed" | "invalid-range" | "binary-source", message: string) {
    super(message)
    this.name = "SourceReadError"
  }
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function sourceContentHash(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex")
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

/** Bounded source reads. Reject links in every relative path component, then
 * verify the opened file identity before/after reading. This is defense in depth,
 * not an OS sandbox against another process with arbitrary filesystem access. */
export async function readProjectSource(rootDir: string, file: string, options: {
  maxBytes?: number; signal?: AbortSignal
} = {}): Promise<{ source: string; hash: string; rawSha256: string; rawBytes: Buffer; lines: string[]; bytes: number }> {
  options.signal?.throwIfAborted()
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid source byte limit")
  if (!file || file.includes("\0") || path.isAbsolute(file) || path.win32.isAbsolute(file)) {
    throw new SourceReadError("outside-root", "Source must be relative to the project root")
  }
  const root = await fs.realpath(rootDir)
  const absolute = path.resolve(root, file)
  if (!isWithinRoot(root, absolute) || absolute === root) {
    throw new SourceReadError("outside-root", "Source points outside the project root")
  }
  let current = root
  for (const component of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, component)
    if ((await fs.lstat(current)).isSymbolicLink()) {
      throw new SourceReadError("unsafe-source", "Symbolic links are not accepted as source paths")
    }
  }
  const canonical = await fs.realpath(absolute)
  if (!isWithinRoot(root, canonical)) throw new SourceReadError("outside-root", "Source resolves outside the project root")
  const before = await fs.lstat(canonical)
  if (!before.isFile()) throw new SourceReadError("unsafe-source", "Source must be a regular file")
  if (before.size > maxBytes) throw new SourceReadError("source-too-large", "Source exceeds the configured byte limit")
  const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFile(before, opened)) throw new SourceReadError("source-changed", "Source changed before opening")
    // Linux exposes the actual opened path, including directory-link races.
    if (process.platform === "linux") {
      const openedPath = await fs.realpath(`/proc/self/fd/${handle.fd}`)
      if (!isWithinRoot(root, openedPath)) throw new SourceReadError("outside-root", "Opened source is outside the project root")
    }
    const chunks: Buffer[] = []
    let bytes = 0
    while (true) {
      options.signal?.throwIfAborted()
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - bytes + 1))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes)
      if (!bytesRead) break
      bytes += bytesRead
      if (bytes > maxBytes) throw new SourceReadError("source-too-large", "Source grew beyond the byte limit")
      chunks.push(buffer.subarray(0, bytesRead))
    }
    options.signal?.throwIfAborted()
    const after = await handle.stat()
    const finalPath = await fs.realpath(absolute)
    const finalStat = await fs.lstat(absolute)
    if (finalPath !== canonical || !isWithinRoot(root, finalPath) || !sameFile(opened, after) || !sameFile(after, finalStat)) {
      throw new SourceReadError("source-changed", "Source changed while reading")
    }
    const buffer = Buffer.concat(chunks, bytes)
    if (buffer.includes(0)) throw new SourceReadError("binary-source", "Binary content is not source text")
    const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    return { source, hash: sourceContentHash(source), rawSha256: createHash("sha256").update(buffer).digest("hex"), rawBytes: buffer, lines: source.split(/\r?\n/), bytes }
  } finally {
    await handle.close()
  }
}

export function validateSourceRange(lines: readonly string[], startLine: number, endLine: number): void {
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new SourceReadError("invalid-range", "Source range no longer exists; refresh the result before expanding it")
  }
}
