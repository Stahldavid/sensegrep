// Optional paid live smoke using synthetic source only. Credentials resolved by core, never printed.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {selectJevBlocks} from '../packages/core/dist/tool/jev-blocks.js'
import {attachJevConstants} from '../packages/core/dist/tool/jev-bundles.js'
import {evaluateWithJev} from '../packages/core/dist/tool/jev.js'
if(!process.argv.includes('--live')) throw new Error('Pass --live to authorize remote smoke calls')
const source=`export function doubledPrice(price) {\n if (price < 0) throw new Error("negative price")\n const unrelated = "${'unrelated illustration '.repeat(300)}"\n const total = price * 2\n return total\n}`
const row={file:'price.ts',startLine:1,endLine:6,content:source,metadata:{symbolName:'doubledPrice',snippetIntegrity:'complete'},semanticScore:.8}
const blocks=await selectJevBlocks('How is the doubled price calculated?', [row], 350,[{id:'a0',text:'calculate doubled price',origin:'caller'}],10000)
assert.equal(blocks.diagnostics?.status,'complete')
const excerpt=blocks.results[0]
if(excerpt.contentTruncated) {
  assert.match(excerpt.content,/if \(price < 0\)/);assert.match(excerpt.content,/return total/)
  assert.equal(excerpt.metadata.snippetIntegrity,'partial')
}
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sensegrep-jev-constant-smoke-'))
const constants='const ALGORITHM = "aes-256-gcm"\nexport function algorithm() { return ALGORITHM }'
await fs.writeFile(path.join(root,'crypto.ts'),constants)
const bundled=await attachJevConstants({projectDirectory:root,meta:{files:{'crypto.ts':{hash:createHash('sha1').update(constants).digest('hex')}}}},[
  {file:'crypto.ts',startLine:2,endLine:2,content:constants.split('\n')[1],semanticScore:.8,metadata:{symbolName:'algorithm'}}])
assert.equal(bundled[0].bundleSources?.[0]?.symbol,'ALGORITHM')
const evaluated=await evaluateWithJev('Which encryption algorithm is returned?',bundled,{mode:'both',timeoutMs:10000})
assert.equal(evaluated.diagnostics.status,'complete')
console.log(JSON.stringify({blocks:{status:blocks.diagnostics.status,excerptProduced:!!excerpt.contentTruncated,sourceChars:source.length,resultChars:excerpt.content.length,cost:blocks.diagnostics.cost},
  constants:{status:evaluated.diagnostics.status,sourceCount:bundled[0].bundleSources.length,cost:evaluated.diagnostics.cost}},null,2))
