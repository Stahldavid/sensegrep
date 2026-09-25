import { describe, it, expect } from "vitest"
import { planJevRecovery, recoveredConstants } from "./jev-recovery.js"
import type { WorkingResult } from "./sensegrep-pipeline.js"
const row: WorkingResult = { file:"policy.ts", startLine:3, endLine:5, content:"function valid(n) { return n > LIMIT }", semanticScore:.8,
  metadata:{symbolName:"valid"}, jev:{relevant:.9,evidence:.9,contradiction:0,aspects:{a0:.9,a1:.1},dimensions:{missing_configuration:.95}} }
describe("bounded gap recovery", () => {
  it('recovers from a partial actual packet even if per-candidate aspects look covered',()=>{
    const completeAspects={...row,jev:{...row.jev!,aspects:{a0:.99},dimensions:{}}}
    const packet={verdict:'partial-evidence',missingAspects:[]}
    const plan=planJevRecovery([completeAspects],[{id:'a0',text:'rule',origin:'query'}],1,packet)
    expect(plan.helpers).toEqual([completeAspects])
    expect(plan.configurations).toEqual([completeAspects])
  })
  it('can explore a relevant delegating wrapper without calling it answer evidence',()=>{
    const wrapper={...row,jev:{relevant:.9,evidence:.1,contradiction:0,dimensions:{missing_helper:.95}}}
    expect(planJevRecovery([wrapper],[],5).helpers).toHaveLength(1)
    expect(planJevRecovery([{...wrapper,jev:{...wrapper.jev,dimensions:{}}}],[],5).helpers).toHaveLength(0)
  })
  it("keeps a missing requirement visible despite strong support for another", () => {
    const plan=planJevRecovery([row],[{id:"a0",text:"amount",origin:"caller"},{id:"a1",text:"exception",origin:"caller"}],5)
    expect(plan.missingAspects).toEqual(["exception"])
    expect(plan.actions).toEqual(["resolve-existing-calls","resolve-referenced-literals"])
    expect(planJevRecovery([{...row,contentTruncated:true}],[],5).actions).toEqual([])
  })
  it("turns verified literal bundles into bounded deduplicated returned source", () => {
    const constants=Array.from({length:8},(_,i)=>({file:"policy.ts",symbol:`L${i}`,startLine:i+10,endLine:i+10,content:`const L${i} = ${i}`}))
    const found=recoveredConstants([{...row,bundleSources:constants},{...row,bundleSources:constants}],[])
    expect(found).toHaveLength(4)
    expect(found[0].content).toBe("const L0 = 0")
    expect(recoveredConstants([{...row,bundleSources:constants.slice(0,1)}],found)).toEqual([])
  })
})
