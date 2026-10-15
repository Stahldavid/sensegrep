import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const files = readdirSync(new URL('.', import.meta.url)).filter(name => /^test-.*\.py$/.test(name)).sort()
if (!files.length) throw new Error('No Python test files found')
for (const file of files) {
  const result = spawnSync(python, [`scripts/${file}`], {stdio:'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) {process.exitCode = result.status ?? 1; break}
}
