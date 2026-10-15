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

test('concurrent processes reclaim a dead lock with only one owner at a time', () => fixture(async file => {
  await fs.writeFile(file,JSON.stringify({pid:2147483647,token:'dead'}))
  const child = path.join(path.dirname(file),'child.mjs')
  const marker = path.join(path.dirname(file),'owner')
  await fs.writeFile(child,`import fs from 'node:fs/promises'
import {acquireBuildLock} from ${JSON.stringify(new URL('./build-lock.mjs',import.meta.url).href)}
const release=await acquireBuildLock(process.argv[2],{timeoutMs:5000,pollMs:1})
try {
 const marker=await fs.open(process.argv[3],'wx')
 await new Promise(r=>setTimeout(r,15))
 await marker.close()
 await fs.unlink(process.argv[3])
} finally {await release()}
`)
  const {spawn} = await import('node:child_process')
  const results = await Promise.all(Array.from({length:8},()=>new Promise(resolve=>{
    const proc=spawn(process.execPath,[child,file,marker],{stdio:['ignore','pipe','pipe']})
    let stderr='';proc.stderr.on('data',chunk=>{stderr+=chunk})
    proc.on('error',error=>resolve({code:-1,stderr:String(error)}))
    proc.on('close',code=>resolve({code,stderr}))
  })))
  for(const result of results) assert.equal(result.code,0,result.stderr)
  await assert.rejects(fs.stat(file),{code:'ENOENT'})
  await assert.rejects(fs.stat(file+'.reclaim'),{code:'ENOENT'})
}))
test('an abandoned reclamation guard fails closed', () => fixture(async file => {
  await fs.writeFile(file,JSON.stringify({pid:2147483647,token:'dead'}))
  await fs.writeFile(file+'.reclaim','abandoned')
  await assert.rejects(acquireBuildLock(file,{timeoutMs:10,pollMs:1}),/reclamation guard/)
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).token,'dead')
}))
test('an expired malformed lock can be recovered', () => fixture(async file => {
  await fs.writeFile(file,'')
  await fs.utimes(file,new Date(0),new Date(0))
  await (await acquireBuildLock(file,{malformedGraceMs:1}))()
  await assert.rejects(fs.stat(file),{code:'ENOENT'})
}))

async function windowsFixture(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process,'platform',{...descriptor,value:'win32'})
  try {return await fn()} finally {Object.defineProperty(process,'platform',descriptor)}
}
test('transient Windows open sharing errors retry without changing ownership rules', () => fixture(file => windowsFixture(async () => {
  const original = fs.open
  let attempts=0
  fs.open=async (...args)=>{
    if(args[0]===file && ++attempts===1) throw Object.assign(new Error('delete pending'),{code:'EPERM'})
    return original(...args)
  }
  try {
    const release=await acquireBuildLock(file,{timeoutMs:200,pollMs:1})
    assert.equal(attempts,2)
    await release()
    await assert.rejects(fs.stat(file),{code:'ENOENT'})
  } finally {fs.open=original}
})))
test('transient Windows reads never evict a live lock owner', () => fixture(file => windowsFixture(async () => {
  const original = fs.readFile
  await fs.writeFile(file,JSON.stringify({pid:process.pid,token:'live'}))
  let attempts=0
  fs.readFile=async (...args)=>{
    if(args[0]===file && ++attempts===1) throw Object.assign(new Error('delete pending'),{code:'EPERM'})
    return original(...args)
  }
  try {
    await assert.rejects(acquireBuildLock(file,{timeoutMs:40,pollMs:1}),/Timed out/)
    assert.ok(attempts>1)
    assert.equal(JSON.parse(await original(file,'utf8')).token,'live')
  } finally {fs.readFile=original}
})))
for (const code of ['EPERM','EACCES']) {
  test(`persistent Windows ${code} fails closed with bounded retries`, () => fixture(file => windowsFixture(async () => {
    const original=fs.readFile, originalUnlink=fs.unlink
    await fs.writeFile(file,JSON.stringify({pid:2147483647,token:'dead-but-unreadable'}))
    let attempts=0,unlinks=0
    fs.readFile=async (...args)=>{
      if(args[0]===file){attempts++;throw Object.assign(new Error('permission denied'),{code})}
      return original(...args)
    }
    fs.unlink=async (...args)=>{if(args[0]===file)unlinks++;return originalUnlink(...args)}
    try {
      await assert.rejects(acquireBuildLock(file,{timeoutMs:500,pollMs:1}),{code})
      assert.equal(attempts,code==='EPERM'?4:1)
      assert.equal(unlinks,0)
      assert.equal(JSON.parse(await original(file,'utf8')).token,'dead-but-unreadable')
    } finally {fs.readFile=original;fs.unlink=originalUnlink}
  })))
}
