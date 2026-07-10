import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { GitScope } from "./git.js"

let temporaryRoot: string | undefined

function git(...args: string[]) {
  execFileSync("git", ["-C", temporaryRoot!, ...args], { stdio: "ignore" })
}

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe("GitScope", () => {
  it("returns modified and untracked files using project-relative paths", async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sensegrep-git-"))
    git("init")
    git("config", "user.email", "sensegrep@example.test")
    git("config", "user.name", "Sensegrep Test")
    await writeFile(path.join(temporaryRoot, "tracked.ts"), "export const value = 1\n")
    git("add", "tracked.ts")
    git("commit", "-m", "initial")
    await writeFile(path.join(temporaryRoot, "tracked.ts"), "export const value = 2\n")
    await writeFile(path.join(temporaryRoot, "new.ts"), "export const next = 1\n")

    await expect(GitScope.changedFiles(temporaryRoot)).resolves.toEqual(["new.ts", "tracked.ts"])
  })
})
