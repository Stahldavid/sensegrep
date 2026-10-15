import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => `scripts/${name}`)
const result = spawnSync(process.execPath, ['--test', ...files], {stdio:'inherit'})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
