import path from "node:path"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { describe, it, expect } from "vitest"
import "./index.js"
import { detectProjectLanguages, formatDetectedLanguages } from "./autodetect.js"

const TEST_DIR = path.join(process.cwd(), ".test-language-autodetect")

describe("language autodetection", () => {
  it("detects supported languages from file extensions", async () => {
    await mkdir(TEST_DIR, { recursive: true })
    await writeFile(path.join(TEST_DIR, "a.ts"), "export const a = 1\n")
    await writeFile(path.join(TEST_DIR, "b.py"), "def run():\n    pass\n")
    await writeFile(path.join(TEST_DIR, "c.js"), "export const c = 3\n")
    await writeFile(path.join(TEST_DIR, "README.txt"), "not a code file\n")

    try {
      const detected = await detectProjectLanguages(TEST_DIR)
      const ids = detected.map((d) => d.language)

      expect(ids).toEqual(expect.arrayContaining(["typescript", "python", "javascript"]))
      expect(detected.find((d) => d.language === "typescript")?.fileCount).toBe(1)
      expect(detected.find((d) => d.language === "python")?.fileCount).toBe(1)
      expect(detected.find((d) => d.language === "javascript")?.fileCount).toBe(1)
    } finally {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })

  it("formats output and handles empty detection", () => {
    expect(formatDetectedLanguages([])).toBe("No supported languages detected.")

    const formatted = formatDetectedLanguages([
      { language: "python", fileCount: 2, percentage: 100 },
    ])
    expect(formatted).toContain("Detected languages:")
    expect(formatted).toContain("python: 2 files (100.0%)")
  })
})
