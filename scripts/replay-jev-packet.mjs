import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {assessJevPacket} from '../packages/core/dist/tool/jev.js'
import {evidenceAspects,evidenceKey} from '../packages/core/dist/tool/jev-coverage.js'
import {TreeSitterChunking} from '../packages/core/dist/semantic/chunking-treesitter.js'
import {gateWitnessAssessment} from '../packages/core/dist/tool/jev-witness.js'
const [input,id,root,output]=process.argv.slice(2)
if(!output||existsSync(output)) throw Error('Usage: replay-jev-packet <split.json> <id> <root> <new-output.json>')
if(!process.env.SENSEGREP_RESEARCH_BUDGET) throw Error('Run with shared budget preload')
const document=JSON.parse(readFileSync(input,'utf8')),row=document.rows.find(r=>r.id===id&&r.arm==='recovery')
const fixture=JSON.parse(readFileSync('scripts/fixtures/jev-v9-reviewed-curaai.json','utf8')).cases.find(c=>c.id===id)
if(!row||!fixture) throw Error('Missing case')
const files=new Map()
const sources=row.results.map(r=>{
  const absolute=path.resolve(root,r.file),relative=path.relative(path.resolve(root),absolute)
  if(relative.startsWith('..')||path.isAbsolute(relative)) throw Error('Source outside root')
  const text=readFileSync(absolute,'utf8').replaceAll('\r',''),content=r.content.replaceAll('\r','')
  const offset=text.indexOf(content)
  if(r.contentTruncated||!content||offset<0||text.indexOf(content,offset+1)>=0) throw Error('Source changed or ambiguous')
  files.set(r.file,text)
  const ast=ts.createSourceFile(r.file,content,ts.ScriptTarget.Latest,true)
  let symbol
  function visit(node){if(!symbol&&(ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node)||ts.isClassDeclaration(node))&&node.name)symbol=node.name.getText(ast);ts.forEachChild(node,visit)}
  visit(ast)
  if(!symbol) throw Error('Cannot identify source')
  const startLine=text.slice(0,offset).split('\n').length
  return {file:r.file,startLine,endLine:startLine+content.split('\n').length-1,content,metadata:{symbolName:symbol},semanticScore:0}
})
for(const [file,text] of files) {
  const references=[...await TreeSitterChunking.graphCalls(text,file),...await TreeSitterChunking.evidenceReferences(text,file)]
  for(const reference of references) {
    const caller=sources.find(r=>r.file===file&&reference.line>=r.startLine&&reference.line<=r.endLine)
    if(!caller) continue
    const targetStem=reference.module?path.posix.normalize(path.posix.join(path.posix.dirname(file),reference.module)).replace(/\.[cm]?[jt]sx?$/,''):file.replace(/\.[cm]?[jt]sx?$/,'')
    const target=sources.find(r=>r.metadata.symbolName===reference.target&&[targetStem,targetStem+'/index'].includes(r.file.replace(/\.[cm]?[jt]sx?$/,'')))
    if(!target) continue
    ;(target.evidenceRelations??=[]).push({caller:evidenceKey(caller),file,line:reference.line,target:`${target.file}:${reference.target}`,
      kind:reference.reference?'reference':reference.scheduled?'scheduled-call':'call',resolved:true,callsite:'',callerSignature:''})
  }
}
writeFileSync(output,JSON.stringify({id,status:'started',sourceEvaluation:input})+'\n',{flag:'wx'})
const aspects=evidenceAspects(fixture.query).map(a=>row.jev?.queryInterpretation?.openQuestion?{...a,queryMode:'open-question'}:a)
const inspection={status:row.jev?.dependencyCheck?.status??'not-assessed',pending:row.jev?.dependencyCheck?.pending??[]}
const result=await assessJevPacket(fixture.query,sources,{mode:'evidence',jointPacket:true,aspects,inspection,timeoutMs:10000})
const gated=gateWitnessAssessment(result,inspection.pending,inspection.status==='complete',aspects)
writeFileSync(output,JSON.stringify({id,status:'completed',sourceEvaluation:input,method:'Freshness-checked replay of identical source contents; no reranking or changed gold labels.',result:gated},null,2)+'\n')
console.log(JSON.stringify({id,status:result.evaluation.status,requests:result.evaluation.requests,verdict:gated.verdict,cost:result.evaluation.cost,reason:gated.reason}))
