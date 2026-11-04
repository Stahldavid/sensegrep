import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/

function reportTags(reportPath, write) {
  let report
  try { report = readFileSync(reportPath, "utf8") }
  catch (error) { if (error.code === "ENOENT") return; throw error }
  const emitted = new Set()
  for (const line of report.split("\n")) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event?.type !== "git-tag" || typeof event.packageName !== "string" || typeof event.tag !== "string") continue
    if (event.packageName.length > 214 || !packageNamePattern.test(event.packageName) || /\s/.test(event.tag)) continue
    const prefix = `${event.packageName}@`
    if (!event.tag.startsWith(prefix) || !versionPattern.test(event.tag.slice(prefix.length)) || emitted.has(event.tag)) continue
    emitted.add(event.tag)
    // Changesets 3 reports tags as JSONL; changesets/action 1.5.3 still parses this line.
    write(`New tag: ${event.tag}\n`)
  }
}

export function publishChangesets({
  changesetBin = require.resolve("@changesets/cli/bin.js"),
  runner = spawnSync,
  env = process.env,
  write = line => process.stdout.write(line),
} = {}) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "sensegrep-changesets-"))
  const reportPath = path.join(temporaryDirectory, "output.jsonl")
  try {
    const result = runner(process.execPath, [changesetBin, "publish"], {
      stdio: "inherit",
      env: {
        ...env,
        CHANGESETS_OUTPUT: reportPath,
        NPM_CONFIG_IGNORE_SCRIPTS: "true",
        npm_config_ignore_scripts: "true",
      },
    })
    // Partial publication can create real tags even when a later package fails.
    reportTags(reportPath, write)
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = publishChangesets()
}
