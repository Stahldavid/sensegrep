import { evaluateImplementationContext } from './jev-packages.js'
import { packetFingerprint } from './jev-witness.js'
import { EVIDENCE_POLICY } from './jev-policy.js'
import { sourceHash, orderDependencyInspection, gateWitnessAssessment, dependencyObligations, pendingObligations, packObligations, type DependencyObligation } from "./jev-witness.js"
import { readFileSync } from "node:fs"
import { Tool } from "./tool.js"
import { VectorStore } from "../semantic/lancedb.js"
import { Instance } from "../project/instance.js"
import { Embeddings } from "../semantic/embeddings.js"
import { TreeShaker } from "../semantic/tree-shaker.js"
import {
  collectWorkingResults,
  dedupeOverlapping,
  diversifyResults,
  formatFreshnessWarning,
  getFreshnessSummary,
  prependFreshnessWarning,
  reconstructSymbolResults,
  rerankWorkingResults,
  selectWithinTokenBudget,
  estimateResultTokens,
  matchesStrictStructuralFilters,
  toStructuredSearchResult,
} from "./sensegrep-pipeline.js"
import { SenseGrepParametersSchema } from "./search-schema.js"
import { embeddingConfigFingerprint } from "../semantic/embedding-config.js"
import { assessEvidence, flexibleDiversity, rankEvidence } from "./search-quality.js"
import { assessJevQuery, evaluateWithJev, assessJevPacket, mergeJevDiagnostics, jevResultKey, resolveJevMode, type JevScores } from "./jev.js"
import { evidenceAspects, selectEvidenceCoverage, candidateTrace, selectionDecisions, appendContributions, contributionShortlist, appendReferencedConstants } from "./jev-coverage.js"
import { selectJevBlocks } from "./jev-blocks.js"
import { expandHelpers } from "./helper-expansion.js"
import { rankConstantDependencies } from "./evidence-dependencies.js"
import { attachJevConstants } from "./jev-bundles.js"
import { planJevRecovery, recoveredConstants } from "./jev-recovery.js"
import { labelEvidence, jevStages } from './jev-routing.js'
import { jevDeadline } from "./jev-deadline.js"
import { recoverEvidenceBeam } from './jev-beam.js'
import type { WorkingResult } from './sensegrep-pipeline.js'

const DESCRIPTION = readFileSync(new URL("./sensegrep.txt", import.meta.url), "utf8")
const MAX_LINE_LENGTH = 2000

export const SenseGrepTool = Tool.define("sensegrep", {
  description: DESCRIPTION,
  parameters: SenseGrepParametersSchema,
  async execute(params, ctx): Promise<Tool.Result<Record<string, unknown>>> {
    // Read index metadata first (before any embedding initialization)
    const resolved = await VectorStore.resolveIndexedProject(Instance.directory)
    if (!resolved?.meta.embeddings) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "index-required",
        title: params.query,
        metadata: { matches: 0, indexed: false },
        results: [],
        output:
          "Semantic index not found. Run `sensegrep index` to create the index first.\n\nThis will enable semantic search across your codebase using AI embeddings.",
      }
    }

    const meta = resolved.meta
    const schema = typeof VectorStore.inspectCollectionSchema === "function"
      ? await VectorStore.inspectCollectionSchema(resolved.root)
      : { exists: true, tableName: meta.tableName ?? "chunks", schemaCompatible: true, migrationRequired: false, fields: [] as string[], missingFields: [] as string[] }
    const backwardCompatibleMissingFields = new Set(["calls", "fileKind", "fileRole"])
    const readableLegacySchema = schema.exists && schema.missingFields.every((field) => backwardCompatibleMissingFields.has(field))
    const roleFilterNeedsMigration = schema.missingFields.includes("fileRole") && Boolean(params.includeRole || params.excludeRole)
    if (!schema.schemaCompatible && (!readableLegacySchema || roleFilterNeedsMigration)) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "migration-required",
        title: params.query,
        metadata: { matches: 0, indexed: true, schemaCompatible: false, missingFields: schema.missingFields },
        index: { fresh: null, schemaCompatible: false, snapshotId: `${schema.tableName}:${meta.updatedAt}` },
        results: [],
        warnings: ["Index schema is incompatible and was left unchanged."],
        output: `Index migration required; missing fields: ${schema.missingFields.join(", ")}. Run \`sensegrep index --full --no-watch\`.`,
      }
    }

    // Configure embeddings to match the index
    const indexConfig = {
      provider: meta.embeddings.provider,
      embedModel: meta.embeddings.model,
      embedDim: meta.embeddings.dimension,
    }

    const jevMode = await resolveJevMode(params.jev)
    const jevRequested = jevMode !== "off"
    const stages = jevStages(jevMode,params.jevStages)
    let jev: Awaited<ReturnType<typeof evaluateWithJev>> | undefined
    let jevEvidence: Awaited<ReturnType<typeof assessJevPacket>> | undefined
    const run = async () => {
    if (
      meta.embeddings.configFingerprint &&
      meta.embeddings.configFingerprint !== embeddingConfigFingerprint(Embeddings.getConfig())
    ) {
      return {
        schemaVersion: 1,
        command: params.commandName ?? "search",
        status: "incompatible-embedding-config",
        title: params.query,
        metadata: { matches: 0, indexed: true, incompatibleEmbeddingConfig: true },
        results: [],
        output: "Embedding endpoint/configuration differs from the indexed vector space. Reindex this profile with `sensegrep index --full --no-watch`, or select the matching profile.",
      }
    }
    const startedAt = Date.now()
    const metrics: Record<string, number> = {}
    const warnings: string[] = []
    // Clear any cached tables that might have wrong dimension expectations
    VectorStore.clearProjectCache(resolved.root)
    const freshness = await getFreshnessSummary()
    const freshnessWarning = formatFreshnessWarning(freshness)
    if (freshnessWarning) warnings.push(freshnessWarning)

    const limit = params.limit ?? 10
    const shouldRerank = params.rerank === true

    // Get collection, passing the expected dimension from index metadata
    const collectionStartedAt = Date.now()
    const collection = schema.schemaCompatible
      ? await VectorStore.getCollectionUnsafe(resolved.root, meta.embeddings.dimension)
      : await VectorStore.openCollectionReadOnly(resolved.root)
    metrics.collectionMs = Date.now() - collectionStartedAt

    const resources = {
      meta,
      collection,
      projectDirectory: resolved.root,
      requestedDirectory: Instance.directory,
      subdirPrefix: resolved.subdirPrefix,
      freshness,
      schema,
    }
    const collected = await collectWorkingResults(resources, { ...params, rerank: false }, {
      rawLimit: Math.max(200, params.pattern ? limit * 3 : limit * 2),
      diversify: false,
      signal: ctx.abort,
    })
    if ("output" in collected) return collected
    Object.assign(metrics, collected.metrics)
    metrics.embeddingRequests = collected.retrieval.vectorUsed && metrics.queryEmbeddingCacheHit !== 1 ? 1 : 0
    metrics.estimatedInputTokens = Math.max(1, Math.ceil(params.query.length / 4))
    warnings.push(...collected.warnings)
    const useLexicalOnly = collected.lexicalOnly
    const jevHelpers = collected.results.filter(r => r.jevOnly)
    let workingResults = collected.results.filter(r => !r.jevOnly)

    // Sort by semantic score initially
    workingResults.sort((a, b) => (b.rerankScore ?? b.semanticScore) - (a.rerankScore ?? a.semanticScore))

    // Optional deterministic lexical/structural rerank on top-N candidates
    let rankedResults = workingResults
    if (shouldRerank && workingResults.length > 1) {
      const rerankStartedAt = Date.now()
      rankedResults = rerankWorkingResults(params.query, workingResults)
      metrics.rerankMs = Date.now() - rerankStartedAt
    }
    rankedResults = await reconstructSymbolResults(
      resolved.root,
      rankedResults,
      Object.fromEntries(Object.entries(meta.files ?? {}).map(([file, stat]) => [
        file.replace(/\\/g, "/").replace(/^\.\//, ""),
        stat.collapsibleRegions ?? [],
      ])),
    )

    rankedResults = rankEvidence(params.query, rankedResults)
    if (!params.exact && !params.pattern && !params.symbol && !params.name && !params.symbolType && params.hybrid !== false) {
      const dependencyStarted = Date.now()
      try {
        const anchors = rankedResults.filter(r => ["function", "method"].includes(String(r.metadata.symbolType))).slice(0, 5)
        rankedResults = rankConstantDependencies(rankedResults, await attachJevConstants(resources, anchors, ctx.abort))
        metrics.constantDependenciesPromoted = rankedResults.filter(r => r.whyMatched?.some(reason => reason.startsWith("constant dependency:"))).length
      } catch {
        ctx.abort.throwIfAborted()
        warnings.push("Constant dependency analysis unavailable; original ranking retained.")
      }
      metrics.constantDependencyMs = Date.now() - dependencyStarted
    }
    const minScore = typeof params.minScore === "number" ? params.minScore : undefined
    if (minScore !== undefined) {
      rankedResults = rankedResults.filter((r) => (r.rerankScore ?? r.semanticScore) >= minScore)
    }

    // Dedupe overlapping results within the same file (class vs method, etc.)
    const localDeduped = dedupeOverlapping(rankedResults)
    let dedupedResults = [...localDeduped, ...jevHelpers.filter(helper => (minScore === undefined || (helper.rerankScore ?? helper.semanticScore) >= minScore) && !localDeduped.some(local =>
      local.file === helper.file && local.startLine <= helper.endLine && helper.startLine <= local.endLine))]
    const exactQuery = params.exact || params.symbol || params.name || /^[\w$]+(?:[.:/][\w$]+)*$/.test(params.query)
    // Discover one-hop implementations before semantic gates can reject a wrapper.
    // Local ranking remains separate and is never rewritten by graph-only discovery.
    if (jevRequested && stages.recovery && !exactQuery && params.hybrid !== false && !params.pattern) {
      try {
        const expanded = await expandHelpers(resources, localDeduped.slice(0, 5), params.query, collected.filters,
          new Set(collected.allowedFiles), ctx.abort, true)
        const allowed = expanded.results.filter(r => matchesStrictStructuralFilters(r, params)
          && (minScore === undefined || (r.rerankScore ?? r.semanticScore) >= minScore))
        for (const row of allowed) {
          const i = dedupedResults.findIndex(r => r.file === row.file && r.startLine === row.startLine && r.endLine === row.endLine)
          if (i >= 0) dedupedResults[i] = {...dedupedResults[i], evidenceRelations: row.evidenceRelations ?? dedupedResults[i].evidenceRelations}
          else dedupedResults.push(row)
        }
        metrics.jevStructuralCandidates = allowed.length
      } catch { ctx.abort.throwIfAborted(); warnings.push('Structural recovery unavailable; original candidates retained.') }
    }
    if (params.jevBundles && jevRequested && !exactQuery) dedupedResults = await attachJevConstants(resources, dedupedResults, ctx.abort)
    const maxPerFile = typeof params.maxPerFile === 'number' ? Math.max(0,params.maxPerFile) : (params.exact ? 2 : 1)
    const maxPerSymbol = typeof params.maxPerSymbol === 'number' ? Math.max(0,params.maxPerSymbol) : 2
    const constrain = (rows:WorkingResult[]) => diversifyResults(rows,
      {maxPerFile:params.maxPerFile === undefined && !params.exact ? 0 : maxPerFile,maxPerSymbol})
    const localPacket = selectWithinTokenBudget(
      params.maxPerFile === undefined && !params.exact ? flexibleDiversity(localDeduped,params.query,maxPerSymbol) : constrain(localDeduped),
      params.maxTokens,params.query,limit,params.purpose)
    const aspects = evidenceAspects(params.query, params.jevAspects)
    const packageMode = params.commandName === 'context' && jevRequested && stages.evidence && !exactQuery
    let finalResults:WorkingResult[]
    if(packageMode) {
      const packaged=await evaluateImplementationContext(params.query,dedupedResults,{
        aspects,limit,maxTokens:params.maxTokens??4000,candidates:params.jevCandidates??32,localResults:localPacket.results,
        timeoutMs:params.jevTimeoutMs??30000,signal:ctx.abort,recovery:stages.recovery,
        expand:async parents=>{
          const expanded=await expandHelpers(resources,parents,params.query,collected.filters,new Set(collected.allowedFiles),ctx.abort,true)
          const allowed=expanded.results.filter(r=>matchesStrictStructuralFilters(r,params)
            && (minScore===undefined||(r.rerankScore??r.semanticScore)>=minScore))
          return {...expanded,results:await attachJevConstants(resources,allowed,ctx.abort)}
        },
      })
      jev=packaged.jev;jevEvidence=packaged.evidence;finalResults=packaged.results
      jev.diagnostics.trace=candidateTrace({retrieved:collected.preDedupeResults,deduplicated:dedupedResults,selected:finalResults})
      metrics.estimatedOutputTokens=packaged.estimatedTokens
      metrics.tokenBudgetTruncated=jev.diagnostics.packages?.rejected.some(r=>r.reason==='token-budget')?1:0
      if(jev.diagnostics.status!=='complete') warnings.push('Jev package evaluation incomplete; returned sources do not imply sufficient evidence.')
    } else {
    const deadline = jevDeadline(params.jevTimeoutMs ?? 8000)
    const remainingJevMs = deadline.remaining
    const queryInterpretation = jevRequested && stages.evidence && !exactQuery
      ? await assessJevQuery(params.query,{timeoutMs:Math.max(1,Math.min(1500,deadline.initial())),signal:ctx.abort}) : undefined
    if(queryInterpretation?.openQuestion) for(const aspect of aspects) if(aspect.origin==='query') aspect.queryMode='open-question'
    jev = jevRequested && !exactQuery ? await evaluateWithJev(params.query, dedupedResults, {
      mode: stages.ranking ? 'both' : 'evidence', priority: stages.recovery ? localPacket.results : undefined, aspects, panel: params.jevPanel, batchSize: params.jevBatchSize,
      ranking: params.jevRanking, candidates: params.jevCandidates,
      timeoutMs: stages.evidence ? deadline.initial() : remainingJevMs(), signal: ctx.abort,
    }) : undefined
    if (jev) {
      if(queryInterpretation) {
        mergeJevDiagnostics(jev.diagnostics,queryInterpretation.diagnostics)
        jev.diagnostics.queryInterpretation={assertedPremise:queryInterpretation.assertedPremise,openQuestion:queryInterpretation.openQuestion,status:queryInterpretation.diagnostics.status}
      }
      // Retain validated partial decisions in local order; never fabricate scores
      // for timed-out candidates or treat a partial request as complete.
      if (jev.diagnostics.status === 'partial') jev.results = jev.results.map(r=>{
        const score = jev!.scores.get(jevResultKey(r))
        return score ? {...r,jev:score} : r
      })
      jev.diagnostics.stages = Object.entries(stages).filter(([,enabled])=>enabled).map(([stage])=>stage)
      jev.diagnostics.timeBudget = deadline.allocation
      if (jev.diagnostics.status !== 'complete') warnings.push(`Jev evaluation ${jev.diagnostics.status}: ${jev.diagnostics.reason ?? 'unavailable'}; local ranking retained.`)
    }
    const usable = () => Boolean(jev && jev.scores.size && ['complete','partial'].includes(jev.diagnostics.status))
    let diversifiedResults:WorkingResult[] = []
    let coverageSelected:ReturnType<typeof selectEvidenceCoverage> | undefined
    const selectPacket = (seed: WorkingResult[] = []) => {
      const evidence = labelEvidence(jev?.results ?? dedupedResults,jev?.truncated)
        .filter(r=>!r.jevOnly || usable() && Math.max(r.jev?.evidence ?? 0,r.jev?.dimensions?.dependency ?? 0)>= EVIDENCE_POLICY.admission)
      diversifiedResults = stages.evidence && usable() ? constrain(evidence)
        : params.maxPerFile === undefined && !params.exact ? flexibleDiversity(evidence,params.query,maxPerSymbol) : constrain(evidence)
      coverageSelected = usable() && stages.evidence
        ? selectEvidenceCoverage(diversifiedResults,aspects,params.maxTokens,limit,estimateResultTokens,seed) : undefined
      if (coverageSelected?.results.length) return coverageSelected
      // A relative winner never converts a failed eligibility check into evidence.
      const local = params.maxPerFile === undefined && !params.exact ? flexibleDiversity(localDeduped,params.query,maxPerSymbol) : constrain(localDeduped)
      return selectWithinTokenBudget(stages.evidence ? local : diversifiedResults,params.maxTokens,params.query,limit,params.purpose)
    }
    let budgeted = selectPacket()
    if (params.jevBlocks && usable() && stages.evidence && params.maxTokens && deadline.repair()>100) {
      const blocks = await selectJevBlocks(params.query,diversifiedResults,params.maxTokens,aspects,deadline.repair(),ctx.abort,undefined,params.jevBatchSize)
      if (blocks.results.some(r=>r.contentTruncated)) budgeted = selectWithinTokenBudget(
        constrain(labelEvidence(blocks.results)),params.maxTokens,params.query,limit,params.purpose)
      if (blocks.diagnostics && jev) mergeJevDiagnostics(jev.diagnostics,blocks.diagnostics)
    }
    const verify = async (timeoutMs:number) => {
      const result = await assessJevPacket(params.query,budgeted.results,{mode:'evidence',verifyAspects:params.jevVerifyAspects,
        aspects,timeoutMs,signal:ctx.abort,inspection:{status:dependencyStatus,pending:pendingObligations(obligations,budgeted.results)}})
      if (jev) mergeJevDiagnostics(jev.diagnostics,result.evaluation)
      return result
    }
    // Inspect resolved calls before trusting aggregate sufficiency. Necessity is
    // judged against its real caller, independently of standalone relevance.
    let obligations:DependencyObligation[] = [], obligationCandidates:WorkingResult[] = []
    let dependencyStatus='not-assessed'
    const canRecover = stages.recovery && params.hybrid !== false && !params.pattern && !params.symbolType && !params.variant && !params.decorator
    let inspectedFingerprint='', inspectionPasses=0, inspectionScoreFingerprint=''
    const inspectionScores=new Map<string,JevScores>()
    const inspectionKey=(r:WorkingResult)=>`${jevResultKey(r)}:${sourceHash(r)}`
    const inspectDependencies = async () => {
      const fingerprint=packetFingerprint(params.query,budgeted.results,aspects)
      if(fingerprint===inspectedFingerprint && dependencyStatus==='complete') return
      dependencyStatus='not-assessed'
      if(!jev || !usable() || !stages.evidence || !canRecover || deadline.repair()<=100 || inspectionPasses>=3) return
      inspectionPasses++
      try {
        const expanded=await expandHelpers(resources,budgeted.results,params.query,collected.filters,new Set(collected.allowedFiles),
          AbortSignal.any([ctx.abort,AbortSignal.timeout(Math.max(1,deadline.repair()))]),true)
        // Existing selected helpers can gain newly resolved caller edges too.
        budgeted.results=budgeted.results.map(row=>{
          const updated=expanded.results.find(r=>jevResultKey(r)===jevResultKey(row))
          return updated ? {...row,evidenceRelations:updated.evidenceRelations ?? row.evidenceRelations} : row
        })
        const selectedKeys=new Set(budgeted.results.map(jevResultKey))
        const missing=expanded.results.filter(r=>!selectedKeys.has(jevResultKey(r))
          && r.evidenceRelations?.some(e=>selectedKeys.has(e.caller)) && matchesStrictStructuralFilters(r,params)
          && (minScore===undefined || (r.rerankScore ?? r.semanticScore)>=minScore))
        if(inspectionScoreFingerprint!==fingerprint) {inspectionScores.clear();inspectionScoreFingerprint=fingerprint}
        const bounded=orderDependencyInspection(missing,budgeted.results).filter(r=>!inspectionScores.has(inspectionKey(r))).slice(0,8)
        const judged=await evaluateWithJev(params.query,bounded,{mode:'evidence',rubric:'dependency',aspects,selected:budgeted.results,batchSize:1,
          candidates:8,timeoutMs:Math.max(1,Math.min(1500,deadline.repair())),signal:ctx.abort})
        mergeJevDiagnostics(jev.diagnostics,judged.diagnostics)
        for(const row of bounded) {const score=judged.scores.get(jevResultKey(row));if(score) inspectionScores.set(inspectionKey(row),score)}
        obligationCandidates=missing.map(r=>{
          const score=inspectionScores.get(inspectionKey(r))
          return {...r,jev:score} // Never reuse a standalone score as a necessity decision.
        })
        obligations=dependencyObligations(obligationCandidates,budgeted.results)
        inspectedFingerprint=packetFingerprint(params.query,budgeted.results,aspects)
        dependencyStatus=expanded.truncated || obligationCandidates.some(r=>!r.jev) ? 'partial' : 'complete'
        for(const row of obligationCandidates.filter(r=>(r.jev?.dimensions?.dependency ?? 0)>= EVIDENCE_POLICY.admission)) {
          const i=jev.results.findIndex(r=>jevResultKey(r)===jevResultKey(row))
          if(i>=0) jev.results[i]=row;else jev.results.push(row)
          jev.scores.set(jevResultKey(row),row.jev!)
        }
        const packed=packObligations(budgeted.results,obligationCandidates,obligations,params.maxTokens,limit,estimateResultTokens)
        const boundedPacket=constrain(packed.results)
        budgeted={results:boundedPacket,estimatedTokens:boundedPacket.reduce((n,r)=>n+estimateResultTokens(r),0)}
      } catch {ctx.abort.throwIfAborted();dependencyStatus='unavailable'}
    }
    await inspectDependencies()
    await inspectDependencies() // Newly packed helpers may themselves delegate.
    // Verify the actual budgeted packet, not the leading unbudgeted candidates.
    if (jev && stages.evidence && usable() && deadline.preliminary()>100) jevEvidence = await verify(deadline.preliminary())
    const before = jevEvidence?.verdict ?? 'not-assessed'
    const snapshot=()=>packetFingerprint(params.query,budgeted.results,aspects,{status:dependencyStatus,pending:pendingObligations(obligations,budgeted.results)})
    const originalFingerprint = snapshot()
    const needsRepair = pendingObligations(obligations,budgeted.results).length>0 || !jevEvidence || !['direct-evidence','conflicting-evidence','no-evidence-found'].includes(jevEvidence.verdict)
    if (jev && usable() && stages.recovery && needsRepair && deadline.repair()>100
      && params.hybrid !== false && !params.pattern && !params.symbolType && !params.variant && !params.decorator) {
      const anchors = labelEvidence(budgeted.results.map(r=>jev!.results.find(j=>jevResultKey(j)===jevResultKey(r)) ?? r),jev.truncated)
      const recovery = planJevRecovery(anchors,aspects,limit,pendingObligations(obligations,budgeted.results).length ? {verdict:'partial-evidence',missingAspects:aspects.filter(a=>pendingObligations(obligations,budgeted.results).some(o=>o.requirementIds?.includes(a.id))).map(a=>a.text)} : jevEvidence ?? {verdict:'not-assessed',missingAspects:aspects.map(a=>a.text)})
      jev.diagnostics.recovery = {missingAspects:recovery.missingAspects,actions:recovery.actions,added:0,status:'attempted'}
      try {
        const allowed = (r:WorkingResult) => matchesStrictStructuralFilters(r,params)
          && (minScore === undefined || (r.rerankScore ?? r.semanticScore)>=minScore)
        const judge = async (rows:WorkingResult[]) => {
          if (!rows.length || deadline.repair()<100) return []
          const judged = await evaluateWithJev(params.query,rows,{mode:'evidence',rubric:'dependency',panel:params.jevPanel,
            aspects,selected:budgeted.results,batchSize:1,candidates:rows.length,timeoutMs:deadline.repair(),signal:ctx.abort})
          mergeJevDiagnostics(jev!.diagnostics,judged.diagnostics)
          return judged.diagnostics.status === 'complete' ? labelEvidence(judged.results,judged.truncated) : []
        }
        const constants = recoveredConstants(await attachJevConstants(resources,recovery.configurations,ctx.abort),[]).filter(allowed)
        const depth = params.jevRecoveryDepth ?? 1
        const beam = await recoverEvidenceBeam(recovery.helpers,jev.results,{
          depth,width:params.jevBeamWidth ?? 3,maxCandidates:depth===1?8:12,
          deadline:Date.now()+deadline.repair(),signal:ctx.abort,
        },async parents=>(await expandHelpers(resources,parents,params.query,collected.filters,new Set(collected.allowedFiles),
          AbortSignal.any([ctx.abort,AbortSignal.timeout(Math.max(1,deadline.repair()))]),true)).results.filter(allowed),judge)
        // Exact referenced literals carry structural provenance, not a fabricated
        // standalone model score. They still require their parent in the packet.
        const accepted = [...beam.results,...constants]
        for (const row of accepted) {
          const i = jev.results.findIndex(r=>jevResultKey(r)===jevResultKey(row))
          if (i>=0) jev.results[i]=row; else jev.results.push(row)
          if (row.jev) jev.scores.set(jevResultKey(row),row.jev)
        }
        jev.diagnostics.recovery = {...jev.diagnostics.recovery,added:accepted.length,status:beam.status,depth,evaluated:beam.evaluated,trace:beam.trace}
        metrics.jevRecoveryAdded = accepted.length
        budgeted = selectPacket(budgeted.results)
        // A helper can win the first selection while its necessary caller is
        // omitted. Ask about actual marginal contribution, not a reverse edge or
        // the difference between two independent relevance probabilities.
        const alternatives = contributionShortlist(diversifiedResults,budgeted.results)
        if (alternatives.length && budgeted.results.length<limit && deadline.repair()>100) {
          const contributions = await evaluateWithJev(params.query,alternatives,{mode:'evidence',rubric:'context',aspects:[],
            selected:budgeted.results,batchSize:1,candidates:4,timeoutMs:deadline.repair(),signal:ctx.abort})
          mergeJevDiagnostics(jev.diagnostics,contributions.diagnostics)
          jev.diagnostics.contributionCheck = {status:contributions.diagnostics.status,
            candidates:contributions.results.map(r=>({key:jevResultKey(r),contribution:r.jev?.contribution}))}
          if (contributions.diagnostics.status==='complete') {
            const appended = appendContributions(budgeted.results,contributions.results,params.maxTokens,limit,estimateResultTokens)
            const newParents = appended.results.filter(r=>!budgeted.results.includes(r))
            const literals = deadline.repair()>0 && newParents.length ? recoveredConstants(
              await attachJevConstants(resources,newParents,ctx.abort),appended.results).filter(allowed) : []
            const packed = appendReferencedConstants(appended.results,literals,params.maxTokens,limit,estimateResultTokens)
            const bounded = constrain(packed.results)
            budgeted = {results:bounded,estimatedTokens:bounded.reduce((n,r)=>n+estimateResultTokens(r),0)}
          }
        }
      } catch { ctx.abort.throwIfAborted(); warnings.push('Jev packet recovery unavailable; selected packet retained.') }
    }
    if (obligations.length) {
      const packed=packObligations(budgeted.results,obligationCandidates,obligations,params.maxTokens,limit,estimateResultTokens)
      const bounded=constrain(packed.results)
      budgeted={results:bounded,estimatedTokens:bounded.reduce((n,r)=>n+estimateResultTokens(r),0)}
    }
    await inspectDependencies()
    if(inspectedFingerprint!==packetFingerprint(params.query,budgeted.results,aspects)) dependencyStatus='partial'
    finalResults = budgeted.results
    const changed = snapshot()!==originalFingerprint
    if (changed) jevEvidence = undefined // A verdict belongs only to its exact packet.
    if (jev && stages.evidence && remainingJevMs()>100 && (changed || !jevEvidence || jevEvidence.verdict==='not-assessed')) {
      jevEvidence = await verify(remainingJevMs())
    }
    const pending=pendingObligations(obligations,finalResults)
    if(jev && stages.evidence) {
      jev.diagnostics.dependencyCheck={status:dependencyStatus,examined:obligations.length,pending}
      // An unresolved necessary or uncertain edge cannot be erased by an
      // optimistic model verdict. Failure to inspect is not a negative finding.
      if(jevEvidence) jevEvidence=gateWitnessAssessment(jevEvidence,pending,dependencyStatus==='complete',aspects)
    }
    if (jev && stages.evidence) {
      jev.diagnostics.packetStatus = jevEvidence?.verdict ?? 'not-assessed'
      jev.diagnostics.packetRepair = {before,after:jev.diagnostics.packetStatus,changed}
      jev.diagnostics.selection = selectionDecisions(diversifiedResults.filter(r=>r.jev || finalResults.includes(r)),finalResults,params.maxTokens,limit,estimateResultTokens)
      if (!jevEvidence) warnings.push('Jev final packet not assessed: remote evaluation unavailable or deadline exhausted.')
    }
    finalResults.forEach((result, index) => {
      result.rankScore = Number(((finalResults.length - index) / Math.max(1, finalResults.length)).toFixed(6))
    })
    if (jev) {
      jev.diagnostics.contextStatus = coverageSelected?.results.length ? "coverage-selection" : "local-selection"
      jev.diagnostics.trace = candidateTrace({ retrieved: collected.preDedupeResults, deduplicated: dedupedResults,
        evaluated: jev.results.filter(r => jev!.scores.has(jevResultKey(r))), diversified: diversifiedResults, selected: finalResults })
    }
    metrics.estimatedOutputTokens = budgeted.estimatedTokens
    metrics.tokenBudgetTruncated = params.maxTokens && (finalResults.length < Math.min(limit, diversifiedResults.length) || finalResults.some((r) => r.contentTruncated)) ? 1 : 0

    } // legacy search/rerank path keeps symbol-count semantics

    if (finalResults.length === 0) {
      metrics.totalMs = Date.now() - startedAt
      return {
        title: params.query,
        metadata: { matches: 0, indexed: true, freshness, warnings, metrics },
        freshness,
        warnings,
        metrics,
        retrieval: collected.retrieval,
        results: [],
        output: prependFreshnessWarning("No matching results found for your query.", freshness),
      }
    }

    // Apply semantic tree-shaking if enabled (default: true)
    const shouldShake = params.shake !== false && !useLexicalOnly
    
    if (shouldShake) {
      const shakeStartedAt = Date.now()
      // Get pre-computed collapsible regions from the index
      const indexMeta = await VectorStore.readIndexMeta(Instance.directory)
      const precomputedRegionsMap = new Map<string, TreeShaker.CollapsibleRegion[]>()
      
      if (indexMeta?.files) {
        // Build map of file -> collapsible regions
        for (const result of finalResults) {
          const fileStat = indexMeta.files[result.file]
          if (fileStat?.collapsibleRegions) {
            precomputedRegionsMap.set(result.file, fileStat.collapsibleRegions as TreeShaker.CollapsibleRegion[])
          }
        }
      }

      // Group results by file and apply tree-shaking
      const shakedResults = await TreeShaker.shakeResults(
        finalResults.map((r) => ({
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          content: r.content,
          metadata: r.metadata as Record<string, unknown>,
        })),
        Instance.directory,
        precomputedRegionsMap.size > 0 ? precomputedRegionsMap : undefined
      )
      metrics.treeShakeMs = Date.now() - shakeStartedAt
      metrics.totalMs = Date.now() - startedAt

      // Format output with shaked content
      const outputLines = [`Found ${finalResults.length} results across ${shakedResults.length} files\n`]

      for (const shaked of shakedResults) {
        // File header with stats
        const statsInfo = shaked.stats.collapsedRegions > 0
          ? ` (${shaked.stats.hiddenLines} lines hidden in ${shaked.stats.collapsedRegions} regions)`
          : ""
        outputLines.push(`## ${shaked.file}${statsInfo}`)

        // Show metadata for the relevant matches in this file
        const metaParts: string[] = []
        for (const result of shaked.originalResults) {
          const meta = result.metadata
          const symbolInfo = [meta.symbolName, meta.symbolType].filter(Boolean).join(" ")
          const kindInfo = typeof meta.semanticKind === "string" && meta.semanticKind ? ` (${meta.semanticKind})` : ""
          if (symbolInfo) metaParts.push(`${symbolInfo}${kindInfo}`)
        }
        if (metaParts.length > 0) {
          outputLines.push(`Matches: ${metaParts.join(", ")}`)
        }

        outputLines.push("```")

        // Show shaked content (already collapsed)
        const lines = shaked.shakedContent.split("\n")
        for (const line of lines.slice(0, 100)) {
          const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
          outputLines.push(truncated)
        }
        if (lines.length > 100) {
          outputLines.push(`// ... (${lines.length - 100} more lines) ...`)
        }

        outputLines.push("```\n")
      }

      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          files: shakedResults.length,
          indexed: true,
          shaked: true,
          freshness,
          warnings,
          metrics,
          retrieval: collected.retrieval,
        },
        freshness,
        warnings,
        metrics,
        retrieval: collected.retrieval,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Fallback: original formatting without tree-shaking
    const outputLines = [`Found ${finalResults.length} results\n`]

    for (const result of finalResults) {
      const meta = result.metadata

      // File location with symbol hints
      const hints = []
      if (meta.symbolName) hints.push(meta.symbolName)
      if (meta.symbolType) hints.push(meta.symbolType)

      const location =
        hints.length > 0
          ? `${result.file}:${result.startLine} (${hints.join(", ")})`
          : `${result.file}:${result.startLine}-${result.endLine}`

      outputLines.push(`## ${location}`)

      // Show selective metadata: score + important attributes
      const metaParts = []

      // Always show relevance score
      metaParts.push(`Relevance: ${(Math.max(0, Math.min(1, result.semanticScore)) * 100).toFixed(1)}%`)
      if (result.confidence) {
        metaParts.push(`Ranking strength: ${result.confidence}`)
      }
      if (result.rerankScore !== undefined) {
        metaParts.push(`Rerank: ${result.rerankScore.toFixed(3)}`)
      }

      // Show complexity if it's significant or was filtered
      if (typeof meta.complexity === "number" && meta.complexity > 0) {
        metaParts.push(`Complexity: ${meta.complexity}`)
      }

      // Show if it's a method (has parent scope)
      if (meta.parentScope && typeof meta.parentScope === "string") {
        metaParts.push(`in ${meta.parentScope}`)
      }
      if (meta.semanticKind && typeof meta.semanticKind === "string") {
        metaParts.push(`Kind: ${meta.semanticKind}`)
      }
      if ((params as any).explainFilters && result.whyMatched?.length) {
        metaParts.push(`Why: ${result.whyMatched.join("; ")}`)
      }

      if (metaParts.length > 0) {
        outputLines.push(metaParts.join(" | "))
      }

      outputLines.push("```")

      // Show actual code content
      const lines = result.content.split("\n")
      for (const line of lines.slice(0, 30)) {
        const truncated = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
        outputLines.push(truncated)
      }
      if (lines.length > 30) {
        outputLines.push(`... (${lines.length - 30} more lines)`)
      }

      outputLines.push("```\n")
    }

      metrics.totalMs = Date.now() - startedAt
      return {
        title: params.query,
        metadata: {
          matches: finalResults.length,
          indexed: true,
          freshness,
          warnings,
          metrics,
          retrieval: collected.retrieval,
        },
        freshness,
        warnings,
      metrics,
      retrieval: collected.retrieval,
        results: finalResults.map(toStructuredSearchResult),
        output: prependFreshnessWarning(outputLines.join("\n"), freshness),
      }
    }

    // Use withConfig to match index embeddings and ensure proper cleanup
    const result = await Embeddings.withConfig(indexConfig as any, () =>
      Instance.provide({
        directory: resolved.root,
        fn: run,
      }),
    )
    const freshness = (result as any).freshness
    const metrics = (result as any).metrics ?? {}
    const retrievalTokens = metrics.estimatedInputTokens ?? 0
    const contextTokens = metrics.estimatedOutputTokens ?? 0
    const emittedTokens = Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({
      results: (result as any).results ?? [],
      output: (result as any).output ?? "",
    })) / 4))
    const localEvidence = assessEvidence(params.query, ((result as any).results ?? []).map((r: any) => ({
      ...r, semanticScore: r.score ?? 0, metadata: r.metadata ?? {},
    })))
    const evidence = jevEvidence?.fullyAssessed ? jevEvidence : localEvidence
    if ((result as any).status && !["complete", "incomplete"].includes((result as any).status)) evidence.status = "not-assessed"
    const weakWarning = "Weak evidence: evaluated source candidates provide little answer support for this query. Refine the query or inspect related symbols; this does not prove absence from the repository."
    return {
      schemaVersion: 1,
      command: params.commandName ?? "search",
      status: metrics.tokenBudgetTruncated ? "incomplete" : "complete",
      index: {
        fresh: freshness ? !freshness.isStale : null,
        schemaCompatible: schema.schemaCompatible,
        snapshotId: `${meta.tableName ?? "chunks"}:${meta.updatedAt}`,
      },
      ...result,
      answerSufficiency: evidence.status,
      evidenceAssessment: { ...evidence, ...(jevEvidence && !jevEvidence.fullyAssessed ? { jevAssessment: jevEvidence } : {}) },
      ...(jevRequested ? { jev: jev?.diagnostics ?? { status: "skipped", reason: "exact-query", mode: jevMode } } : {}),
      warnings: [...((result as any).warnings ?? []), ...(evidence.status === "weak-evidence" ? [weakWarning] : [])],
      output: evidence.status === "weak-evidence" ? `${weakWarning}\n\n${result.output}` : result.output,
      budget: {
        maxOutputBytes: params.maxOutputBytes,
        maxBytes: params.maxOutputBytes,
        tokensRequested: params.maxTokens,
        tokensUsed: contextTokens,
        inputTokens: retrievalTokens,
        retrievalTokens,
        contextTokens,
        emittedTokens,
        embeddingRequests: metrics.embeddingRequests ?? 0,
        embeddingTimeoutMs: params.embeddingTimeoutMs ?? params.latencyBudgetMs,
        elapsedMs: metrics.totalMs ?? 0,
      },
    }
  },
})
