#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const packages = [
  {
    workspace: "@sensegrep/core",
    dir: "packages/core",
    requiredFiles: [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/tool/sensegrep.txt",
    ],
  },
  {
    workspace: "@sensegrep/cli",
    dir: "packages/cli",
    requiredFiles: [
      "dist/main.js",
    ],
    bins: [
      "dist/main.js",
    ],
  },
  {
    workspace: "@sensegrep/mcp",
    dir: "packages/mcp",
    requiredFiles: [
      "dist/server.js",
      "dist/server.d.ts",
    ],
    bins: [
      "dist/server.js",
    ],
  },
]

function fail(message) {
  throw new Error(message)
}

function assertFileExists(packageSpec, relativePath) {
  const absolutePath = path.join(rootDir, packageSpec.dir, relativePath)
  if (!fs.existsSync(absolutePath)) {
    fail(`${packageSpec.workspace} is missing required artifact: ${relativePath}`)
  }
}

function assertBinShebang(packageSpec, relativePath) {
  const absolutePath = path.join(rootDir, packageSpec.dir, relativePath)
  const content = fs.readFileSync(absolutePath, "utf8")
  if (!content.startsWith("#!/usr/bin/env node\n")) {
    fail(`${packageSpec.workspace} bin artifact is missing node shebang: ${relativePath}`)
  }
}

function quoteCmdArg(value) {
  return /^[A-Za-z0-9_./:@-]+$/.test(value)
    ? value
    : `"${value.replace(/"/g, '\\"')}"`
}

function runNpm(args) {
  if (process.platform === "win32") {
    const command = ["npm", ...args].map(quoteCmdArg).join(" ")
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  }

  return spawnSync("npm", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function npmPackDryRun(packageSpec) {
  const result = runNpm(["pack", "--dry-run", "--workspace", packageSpec.workspace, "--json"])

  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`npm pack --dry-run failed for ${packageSpec.workspace}\n${result.stderr || result.stdout}`)
  }

  const parsed = JSON.parse(result.stdout)
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  const packedFiles = new Set((entry.files ?? []).map((file) => file.path))
  for (const requiredFile of packageSpec.requiredFiles) {
    if (!packedFiles.has(requiredFile)) {
      fail(`${packageSpec.workspace} package would not include required artifact: ${requiredFile}`)
    }
  }
}

for (const packageSpec of packages) {
  for (const file of packageSpec.requiredFiles) {
    assertFileExists(packageSpec, file)
  }
  for (const file of packageSpec.bins ?? []) {
    assertBinShebang(packageSpec, file)
  }
  npmPackDryRun(packageSpec)
  console.log(`Verified release artifacts for ${packageSpec.workspace}`)
}
