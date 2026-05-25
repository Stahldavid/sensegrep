import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { clearProjectIndexFilterCache, shouldIgnoreIndexedFile } from "./index-filters.js"

const tempDirs: string[] = []

function makeProject(config?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sensegrep-index-filter-"))
  tempDirs.push(dir)
  if (config) {
    fs.writeFileSync(path.join(dir, "sensegrep.config.json"), JSON.stringify(config, null, 2))
  }
  return dir
}

describe("index filters", () => {
  afterEach(() => {
    clearProjectIndexFilterCache()
  })

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("ignores minified files by default", () => {
    const dir = makeProject()
    expect(shouldIgnoreIndexedFile(dir, "frontend-admin/src/public/tinymce/plugin.min.js")).toBe(true)
    expect(shouldIgnoreIndexedFile(dir, "frontend-admin/src/public/tinymce/plugin.js.map")).toBe(true)
  })

  it("applies project include globs", () => {
    const dir = makeProject({
      index: {
        include: ["frontend-store/**/*.vue"],
      },
    })

    expect(shouldIgnoreIndexedFile(dir, "frontend-store/pages/checkout/index.vue")).toBe(false)
    expect(shouldIgnoreIndexedFile(dir, "frontend-admin/src/middleware/auth.global.ts")).toBe(true)
  })

  it("applies project exclude globs", () => {
    const dir = makeProject({
      index: {
        exclude: ["**/src/public/tinymce/**"],
      },
    })

    expect(shouldIgnoreIndexedFile(dir, "frontend-admin/src/public/tinymce/plugins/code/plugin.js")).toBe(true)
    expect(shouldIgnoreIndexedFile(dir, "frontend-admin/src/services/userService.ts")).toBe(false)
  })
})
