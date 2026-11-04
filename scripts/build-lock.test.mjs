import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireBuildLock } from './build-lock.mjs'
const fixture = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensegrep-build-lock-'))
  try { await fn(path.join(dir, 'lock')) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
test('build lock releases only its own token', () => fixture(async file => {
  const release = await acquireBuildLock(file)
  await fs.writeFile(file, JSON.stringify({pid:process.pid,token:'different-owner'}))
  await release()
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).token,'different-owner')
}))
test('a live but old owner is never evicted by age', () => fixture(async file => {
  await fs.writeFile(file,JSON.stringify({pid:process.pid,token:'owner',startedAt:0}))
  await assert.rejects(acquireBuildLock(file,{timeoutMs:5,pollMs:1}),/Timed out/)
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).token,'owner')
}))
test('a partially written fresh lock is not stolen', () => fixture(async file => {
  await fs.writeFile(file,'')
  await assert.rejects(acquireBuildLock(file,{timeoutMs:5,pollMs:1}),/Timed out/)
}))
test('normal acquire/release permits the next builder', () => fixture(async file => {
  await (await acquireBuildLock(file))()
  await (await acquireBuildLock(file))()
  await assert.rejects(fs.stat(file),{code:'ENOENT'})
}))
