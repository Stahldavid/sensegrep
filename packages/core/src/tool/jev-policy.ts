/** Application policy, not calibrated probabilities of correctness. */
export const EVIDENCE_POLICY = {
  admission: .65, sufficient: .8, uncertaintyLow: .2, contradiction: .7, relevant: .7, recovery: .7,
} as const
export const EVIDENCE_CONTRACT = 'evidence-v12-balanced-packages'
