import { EVIDENCE_POLICY } from './jev-policy.js'
import type { JevScores } from './jev.js'
import type { WorkingResult } from './sensegrep-pipeline.js'
import { evidenceKey } from './jev-coverage.js'

export type EvidenceCategory = 'direct' | 'supporting' | 'configuration' | 'test' | 'contradicting' | 'weak' | 'unassessed'
/** Advisory categories, never deletion or a calibrated probability of correctness. */
export function routeEvidence(scores?: JevScores, truncated = false): EvidenceCategory {
  if (!scores || truncated) return 'unassessed'
  if (scores.contradiction >= EVIDENCE_POLICY.contradiction) return 'contradicting'
  if ((scores.dimensions?.dependency ?? 0) >= EVIDENCE_POLICY.admission) return 'supporting'
  if (scores.evidence < EVIDENCE_POLICY.admission) return scores.evidence < EVIDENCE_POLICY.uncertaintyLow ? 'weak' : 'unassessed'
  if (scores.role === 'test') return 'test'
  if (scores.role === 'constant') return 'configuration'
  if ((scores.dimensions?.operation ?? 0) >= EVIDENCE_POLICY.admission || (scores.dimensions?.condition ?? 0) >= EVIDENCE_POLICY.admission || scores.role === 'implementation') return 'direct'
  if (scores.role === 'helper' || (scores.dimensions?.dependency ?? 0) >= EVIDENCE_POLICY.admission) return 'supporting'
  return 'supporting'
}
export function labelEvidence(rows: WorkingResult[], truncated?:Set<string>) {
  return rows.map(row => row.jev ? {...row, jev:{...row.jev, category:routeEvidence(row.jev, !!row.contentTruncated || !!truncated?.has(evidenceKey(row)))}} : row)
}
export function jevStages(mode?: string, stages?: string[]) {
  const active = mode !== undefined && mode !== 'off'
  return { ranking:active && (stages ? stages.includes('rerank') : mode !== 'evidence'),
    evidence:active && (stages ? stages.includes('evidence') : mode !== 'rerank'),
    recovery:active && (stages ? stages.includes('recovery') : mode === 'both') }
}
