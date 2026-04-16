#!/usr/bin/env node
/**
 * Syncs the version from packages/mcp/package.json into:
 *   - server.json (top-level version + packages[@sensegrep/mcp].version)
 *   - packages/mcp/src/server.ts (runtime version string)
 *   - plugin manifests / marketplaces
 *   - plugin .mcp.json files that pin the MCP package
 *
 * Called automatically by `npm run version` after `changeset version`.
 */
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
}

function writeJson(rel, value) {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(value, null, 2) + "\n")
}

const version = readJson("packages/mcp/package.json").version

// ── server.json ──────────────────────────────────────────────────────────────
const serverJson = readJson("server.json")

serverJson.version = version
const mcpEntry = Array.isArray(serverJson.packages)
  ? serverJson.packages.find((p) => p.identifier === "@sensegrep/mcp")
  : null
if (mcpEntry) mcpEntry.version = version
writeJson("server.json", serverJson)
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

// ── plugin/package manifests ────────────────────────────────────────────────
const jsonVersionTargets = [
  "plugin/sensegrep-plugin/.claude-plugin/plugin.json",
  "plugin/sensegrep-plugin/.claude-plugin/marketplace.json",
  "plugin/sensegrep-plugin/.mcp.json",
  "plugin/sensegrep-cursor/.cursor-plugin/plugin.json",
  "plugin/sensegrep-cursor/.mcp.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
]

for (const rel of jsonVersionTargets) {
  const json = readJson(rel)

  if (Array.isArray(json.plugins)) {
    for (const plugin of json.plugins) {
      plugin.version = version
    }
  }

  if (typeof json.version === "string") {
    json.version = version
  }

  if (json.mcpServers && typeof json.mcpServers === "object") {
    for (const server of Object.values(json.mcpServers)) {
      if (server && typeof server === "object" && Array.isArray(server.args)) {
        server.args = server.args.map((arg) =>
          typeof arg === "string" && arg.startsWith("@sensegrep/mcp@")
            ? `@sensegrep/mcp@${version}`
            : arg
        )
      }
    }
  }

  writeJson(rel, json)
  console.log(`sync-versions: ${rel} → ${version}`)
}
