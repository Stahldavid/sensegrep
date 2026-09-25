// Hand-reviewed synthetic behaviors. Test groups are disjoint from development;
// these fixtures are contract checks, not representative production benchmarks.
const specifications=[
  ['hour','dev','validateHour','What exact hour values does validateHour accept?',
    'function validateHour(value) {\n  if (!validHour(value)) throw Error("invalid")\n}',
    'validHour','function validHour(value) {\n  return Number.isInteger(value) && value >= 0 && value <= 23\n}'],
  ['quota','dev','acceptUpload','What exact size limit does acceptUpload enforce?',
    'function acceptUpload(size) {\n  if (size > MAX_BYTES) throw Error("too large")\n}',
    'MAX_BYTES','const MAX_BYTES = 4096',true],
  ['role','dev','deleteAccount','Which roles are allowed to delete an account through deleteAccount?',
    'function deleteAccount(role) {\n  if (!canDelete(role)) throw Error("forbidden")\n  return "deleted"\n}',
    'canDelete','function canDelete(role) {\n  return role === "owner" || role === "admin"\n}'],
  ['refund','test','refund','Which payment states permit a refund through refund?',
    'function refund(state) {\n  if (!refundable(state)) throw Error("blocked")\n  return "refund draft"\n}',
    'refundable','function refundable(state) {\n  return state === "received" || state === "settled"\n}'],
  ['nonce','test','validateNonce','What exact string length does validateNonce require?',
    'function validateNonce(value) {\n  if (value.length !== NONCE_LENGTH) throw Error("bad nonce")\n}',
    'NONCE_LENGTH','const NONCE_LENGTH = 24',true],
  ['retention','test','canDeleteRecord','What age in days allows deletion through canDeleteRecord?',
    'function canDeleteRecord(ageDays) {\n  return oldEnough(ageDays)\n}',
    'oldEnough','function oldEnough(ageDays) {\n  return ageDays >= 90\n}'],
]
const key=r=>`${r.file}:${r.startLine}:${r.endLine}:${r.metadata.symbolName}`
const make=(group,name,content)=>({file:`fixture/${group}/${name}.ts`,startLine:1,endLine:content.split('\n').length,
  content,semanticScore:.8,metadata:{symbolName:name}})
export function witnessCases(split) {
  return specifications.filter(s=>!split || s[1]===split).flatMap(([group,partition,name,query,content,helper,definition,constant])=>{
    const root=make(group,name,content),dependency=make(group,helper,definition)
    if(constant) dependency.requiredBy=[key(root)]
    else dependency.evidenceRelations=[{caller:key(root),file:root.file,line:2,target:`${dependency.file}:${helper}`,kind:'call',resolved:true,
      callsite:content.split('\n')[1],callerSignature:content.split('\n')[0]}]
    const noise=make(group,'unrelated',constant?definition:'function unrelated() { return "blue" }')
    const variants={full:[root,dependency],missing:[root],reverse:[dependency,root],distractor:[root,dependency,noise],
      'missing-with-distractor':[root,noise]}
    return Object.entries(variants).map(([variant,rows])=>({id:`${group}/${variant}`,group,split:partition,query,variant,rows,
      expectedComplete:!variant.startsWith('missing')}))
  })
}
