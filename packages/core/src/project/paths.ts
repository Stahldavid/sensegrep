import { realpathSync } from "node:fs"
import path from "node:path"

/** One local checkout identity for context, locks and storage, including a
 * deleted checkout reached through an existing symlink or short-path parent.
 * Filesystem failures other than missing components are never guessed away. */
export function canonicalCheckoutPath(input: string): string {
  let current = path.resolve(input)
  const missing: string[] = []
  for (;;) {
    try {
      // The JavaScript implementation can preserve DOS 8.3 spellings, while
      // fs.promises.realpath and Windows junction targets use long names.
      const resolved = process.platform === "win32" ? realpathSync.native(current) : realpathSync(current)
      return path.join(resolved, ...missing)
    } catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}
