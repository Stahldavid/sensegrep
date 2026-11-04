import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('Python runner discovers .py tests and propagates the first failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sensegrep-python-runner-'))
  try {
    const scripts = path.join(root,'scripts')
    await fs.mkdir(scripts)
    await fs.copyFile(new URL('./run-python-tests.mjs',import.meta.url),path.join(scripts,'run.mjs'))
    // Use Node as a deterministic fake interpreter. The suffix still must be .py,
    // and the real Python suites are executed separately by test:python.
    for (const id of ['a','b']) {
      await fs.writeFile(path.join(scripts,`test-${id}.py`),
        `require('node:fs').appendFileSync('calls.log','${id}\\n');process.exit(Number(process.env.FAIL_PROBE??0))`)
    }
    const run = extra => spawnSync(process.execPath,[path.join(scripts,'run.mjs')],{
      cwd:root,env:{...process.env,PYTHON:process.execPath,...extra},encoding:'utf8'
    })
    assert.equal(run({}).status,0)
    assert.equal((await fs.readFile(path.join(root,'calls.log'),'utf8')).trim(),'a\nb')
    await fs.writeFile(path.join(root,'calls.log'),'')
    assert.equal(run({FAIL_PROBE:'7'}).status,7)
    assert.equal((await fs.readFile(path.join(root,'calls.log'),'utf8')).trim(),'a')
    await fs.unlink(path.join(scripts,'test-a.py'))
    await fs.unlink(path.join(scripts,'test-b.py'))
    const empty=run({})
    assert.notEqual(empty.status,0)
    assert.match(empty.stderr,/No Python test files found/)
  } finally {await fs.rm(root,{recursive:true,force:true})}
})
