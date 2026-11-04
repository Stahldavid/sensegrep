import {describe,expect,it} from "vitest"
import {planDuplicateMemory} from "./duplicate-memory.js"
describe('duplicate memory budget',()=>{
  it('includes both cached distances and normalized vectors',()=>{
    expect(planDuplicateMemory(4,2,'cosine').estimatedAdditionalBytes).toBe(112)
  })
  it('retains the original small-set strategy within a bounded budget',()=>{
    expect(planDuplicateMemory(4096,1536,'cosine').strategy).toBe('memory-cosine')
  })
  it('falls back before allocating a cache that exceeds the budget',()=>{
    expect(planDuplicateMemory(4096,3072,'cosine').strategy).toBe('vector-store')
    expect(planDuplicateMemory(10,10,'cosine',0).reason).toBe('memory-budget')
  })
  it('rejects invalid configuration instead of silently disabling the bound',()=>{
    expect(()=>planDuplicateMemory(10,10,'cosine',NaN)).toThrow()
  })
})
