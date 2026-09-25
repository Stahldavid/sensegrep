import { expect, it } from "vitest"
import { TreeSitterChunking } from "../semantic/chunking-treesitter.js"
import { rankConstantDependencies } from "./evidence-dependencies.js"
import type { WorkingResult } from "./sensegrep-pipeline.js"

const row = (name:string, line:number, score:number, file="rule.ts"):WorkingResult => ({
  file, startLine:line, endLine:line, content:`const ${name} = 1`, semanticScore:score,
  metadata:{symbolName:name, symbolType:"variable"},
})
it("retains a referenced arithmetic constant but excludes calls and environment reads", async () => {
  const source = 'const AGE = 30 * Time.DAY\nconst DYNAMIC = Date.now()\nconst SECRET = process.env.KEY\nfunction rule() { return AGE + DYNAMIC + SECRET }'
  const deps=await TreeSitterChunking.evidenceConstants(source,"rule.ts",4,4)
  expect(deps.map(d=>d.symbol)).toEqual(["AGE"])
})
it("does not treat a shadowed constant as a dependency", async () => {
  const deps=await TreeSitterChunking.evidenceConstants('const AGE = 30 * Time.DAY\nfunction rule(AGE:number) { return AGE }',"rule.ts",2,2)
  expect(deps).toEqual([])
})
it("promotes only in-scope source-matched dependencies and keeps the anchor first", () => {
  const anchor=row("rule",10,.9),constant=row("AGE",1,.1),unrelated=row("unrelated",20,.8)
  anchor.bundleSources=[{file:"rule.ts",symbol:"AGE",startLine:1,endLine:1,content:constant.content}]
  const ranked=rankConstantDependencies([anchor,unrelated,constant],[anchor])
  expect(ranked.map(r=>r.metadata.symbolName)).toEqual(["rule","unrelated","AGE"])
  expect(ranked[2].rerankScore).toBeCloseTo(.765)
  expect(rankConstantDependencies([anchor,unrelated],[anchor])).toEqual([anchor,unrelated])
  expect(rankConstantDependencies([anchor,{...constant,file:"other.ts"}],[anchor])[1].rerankScore).toBeUndefined()
})
it("bounds promotions to two and never promotes partial source", () => {
  const anchor=row("rule",10,.9),constants=[row("A",1,.1),row("B",2,.1),row("C",3,.1)]
  anchor.bundleSources=constants.map(c=>({file:c.file,symbol:String(c.metadata.symbolName),startLine:c.startLine,endLine:c.endLine,content:c.content}))
  const ranked=rankConstantDependencies([anchor,...constants],[anchor])
  expect(ranked.filter(r=>r.rerankScore!==undefined)).toHaveLength(2)
  constants[0].contentTruncated=true
  expect(rankConstantDependencies([anchor,...constants],[anchor]).find(r=>r.metadata.symbolName==="A")?.rerankScore).toBeUndefined()
})
