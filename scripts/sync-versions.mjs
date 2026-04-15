#!/usr/bin/env node
/**
 * Syncs the version from packages/mcp/package.json into:
 *   - server.json (top-level version + packages[@sensegrep/mcp].version)
 *   - packages/mcp/src/server.ts (runtime version string)
 *
 * Called automatically by `npm run version` after `changeset version`.
 */
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
}

const version = readJson("packages/mcp/package.json").version

// ── server.json ──────────────────────────────────────────────────────────────
const serverJsonPath = path.join(root, "server.json")
const serverJson = readJson("server.json")

serverJson.version = version
const mcpEntry = Array.isArray(serverJson.packages)
  ? serverJson.packages.find((p) => p.identifier === "@sensegrep/mcp")
  : null
if (mcpEntry) mcpEntry.version = version

fs.writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + "\n")
console.log(`sync-versions: server.json → ${version}`)

// ── packages/mcp/src/server.ts ───────────────────────────────────────────────
const serverTsPath = path.join(root, "packages/mcp/src/server.ts")
const original = fs.readFileSync(serverTsPath, "utf8")
const versionPattern = /(?<=new Server\(\s*\{[^}]*version:\s*")[^"]+(?=")/s

if (!versionPattern.test(original)) {
  console.warn("sync-versions: packages/mcp/src/server.ts — no version field found in Server constructor, skipping")
} else {
  const updated = original.replace(versionPattern, version)
  fs.writeFileSync(serverTsPath, updated)
  console.log(`sync-versions: packages/mcp/src/server.ts → ${version}`)
}
