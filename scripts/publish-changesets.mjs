import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const changesetBin = require.resolve("@changesets/cli/bin.js")

const result = spawnSync(process.execPath, [changesetBin, "publish"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    npm_config_ignore_scripts: "true",
  },
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
