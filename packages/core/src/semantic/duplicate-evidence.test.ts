import {describe,it,expect} from 'vitest'
import {TreeSitterChunking} from './chunking-treesitter.js'
describe('duplicate literal and operator guard',()=>{
  const signature=(code:string)=>TreeSitterChunking.literalOperatorSignature(code,'rule.ts')
  it('preserves status mappings that identifier normalization erases',async()=>{
    expect(await signature('function a(x) { return x === "PAID" ? "settled" : "pending" }'))
      .not.toBe(await signature('function b(x) { return x === "REFUNDED" ? "settled" : "pending" }'))
  })
  it('ignores comments and identifier renaming, but detects operators and constants',async()=>{
    expect(await signature('function a(x) { return x > 30 }'))
      .toBe(await signature('/* x < 60 */ function b(y) { return y > 30 }'))
    expect(await signature('function a(x) { return x > 30 }'))
      .not.toBe(await signature('function a(x) { return x >= 30 }'))
    expect(await signature('function a(x) { return x > 30 }'))
      .not.toBe(await signature('function a(x) { return x > 60 }'))
  })
  it('reports unavailable parsing instead of equivalence for unsupported or invalid source',async()=>{
    expect(await TreeSitterChunking.literalOperatorSignature('def a(): return True','rule.py')).toBeUndefined()
    expect(await signature('function { broken')).toBeUndefined()
  })
})
