import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const cliPath = path.join(process.cwd(), "packages/cli/dist/main.js")
const itIfBuilt = existsSync(cliPath) ? it : it.skip

async function runCli(args: string[]) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
}

describe("CLI JSON stdout contract", () => {
  let tempRoot: string | undefined

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  itIfBuilt("keeps detect-duplicates --json parseable while progress and warnings use stderr", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-json-output-"))
    await writeFile(
      path.join(tempRoot, "sample.ts"),
      "export function calculateTotal(value: number) {\n  return value + 1\n}\n",
    )

    const { stdout, stderr } = await runCli([
      "detect-duplicates",
      "--root",
      tempRoot,
      "--json",
      "--max-candidates",
      "10",
    ])

    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty("summary")
    expect(parsed).toHaveProperty("duplicates")
    expect(stderr).toContain("Detecting logical duplicates")
    expect(stdout).not.toContain("Detecting logical duplicates")
    expect(stdout).not.toContain("WARN")
  })

  itIfBuilt("keeps simple JSON commands parseable without stderr noise", async () => {
    const { stdout, stderr } = await runCli(["semantic-kinds", "--json"])

    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed.semanticKinds)).toBe(true)
    expect(stderr).toBe("")
  })
})
