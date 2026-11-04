export type StageStatus = "complete" | "partial" | "fallback" | "skipped"
export type StageDiagnostic = {
  stage:string; status:StageStatus; reason?:string; requests:number; evaluated:number;
  candidates:number; elapsedMs:number; cost:number
}
export type AggregateDiagnostics = {
  status:StageStatus; reason?:string; reasons?:string[]; stageResults?:StageDiagnostic[];
  requests:number;cacheHits:number;inputTokens:number;outputTokens:number;cost:number;elapsedMs:number;
  evaluated:number;candidates:number;models:string[];unknownUsageRequests?:number;usageComplete?:boolean
}
export function stageDiagnostic(value:AggregateDiagnostics,stage:string):StageDiagnostic {
  return {stage,status:value.status,reason:value.reason,requests:value.requests,
    evaluated:value.evaluated,candidates:value.candidates,elapsedMs:value.elapsedMs,cost:value.cost}
}
export function mergeStageDiagnostics(target:AggregateDiagnostics,extra:AggregateDiagnostics):void {
  const stages=[...(target.stageResults??[stageDiagnostic(target,'candidate-assessment')]),
    ...(extra.stageResults??[stageDiagnostic(extra,'unspecified')])]
  for(const key of ['requests','cacheHits','inputTokens','outputTokens','cost','elapsedMs'] as const) target[key]+=extra[key]
  target.models=[...new Set([...target.models,...extra.models])]
  target.unknownUsageRequests=(target.unknownUsageRequests??0)+(extra.unknownUsageRequests??0)
  target.usageComplete=target.unknownUsageRequests===0
  target.stageResults=stages
  target.reasons=[...new Set([...stages.flatMap(s=>s.reason?[s.reason]:[]),...(target.reasons??[]),...(extra.reasons??[])])]
  const active=stages.filter(s=>s.status!=='skipped')
  target.status=!active.length?'skipped':active.every(s=>s.status==='complete')?'complete'
    :active.some(s=>s.status==='complete'||s.status==='partial'||s.evaluated>0)?'partial':'fallback'
  target.reason=target.reasons.find(r=>r.startsWith('provider-rejected-'))??target.reasons[0]
}
