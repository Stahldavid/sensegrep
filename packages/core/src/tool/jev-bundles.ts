import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import type { SearchResources, WorkingResult } from "./sensegrep-pipeline.js"

/** Advisory judging context only: literal constants, exact source, unchanged indexed files. */
export async function attachJevConstants(resources: SearchResources, rows: WorkingResult[], signal?: AbortSignal) {
  const started = Date.now()
  let parsed = 0
  const files = new Map<string, string | undefined>()
  const result: WorkingResult[] = []
  for(const row of rows) {
    signal?.throwIfAborted()
    if(!files.has(row.file) && files.size<8) {
      const absolute=path.resolve(resources.projectDirectory,row.file), relative=path.relative(resources.projectDirectory,absolute)
      let source: string | undefined
      if(!relative.startsWith("..") && !path.isAbsolute(relative)) try {
        if((await fs.stat(absolute)).size<=128_000) {
          const text=await fs.readFile(absolute,"utf8"), expected=resources.meta.files[row.file]?.hash
          if(expected && createHash("sha1").update(text).digest("hex")===expected) source=text
        }
      } catch { /* Unavailable sources do not become evidence. */ }
      files.set(row.file,source)
    }
    const source=files.get(row.file)
    const constants=source && parsed++ < 80 && Date.now() - started < 500
      ? await TreeSitterChunking.evidenceConstants(source,row.file,row.startLine,row.endLine) : []
    result.push(constants.length ? {...row,bundleSources:constants.map(c=>({...c,file:row.file}))} : row)
  }
  return result
}
