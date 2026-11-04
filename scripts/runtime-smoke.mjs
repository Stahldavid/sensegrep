import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

// Exercise generated published entrypoints, without indexing or embedding providers.
await import("../packages/core/dist/index.js")
const cli = spawnSync(process.execPath, ["packages/cli/dist/main.js", "--help"], {
  encoding: "utf8",
  timeout: 15000,
  env: { ...process.env, SENSEGREP_NETWORK_POLICY: "local-only" },
})
assert.equal(cli.status, 0, cli.stderr || cli.error?.message)
assert.match(cli.stdout, /sensegrep/i)
await import("@modelcontextprotocol/sdk/server/mcp.js")
await import("@modelcontextprotocol/server")
console.log("Published Node runtime smoke passed")
