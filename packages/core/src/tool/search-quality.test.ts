import { describe, expect, it } from "vitest"
import { assessEvidence, flexibleDiversity, rankEvidence } from "./search-quality.js"
import { selectWithinTokenBudget, diversifyResults, type WorkingResult } from "./sensegrep-pipeline.js"
import { projectSearchAgentResponse } from "./agent-output.js"
import { SenseGrepContextParametersSchema } from "./sensegrep-context.js"

const result = (symbol: string, type: string, score: number, content: string, startLine: number, file = "policy.ts"): WorkingResult => ({
  file, content, startLine, endLine: startLine + 3, semanticScore: score,
  metadata: { symbolName: symbol, symbolType: type, fileRole: "implementation" },
})
const constant = result("MAX_SMALL_BALANCE_AGE_MS", "variable", 0.64, "export const MAX_SMALL_BALANCE_AGE_MS = 30 * Time.DAY", 1)
const helper = result("shouldIgnoreMinimumPayout", "function", 0.60,
  "export function shouldIgnoreMinimumPayout(oldestAvailableAt: number, nowMs: number) { return nowMs - oldestAvailableAt >= MAX_SMALL_BALANCE_AGE_MS }", 10)
const query = "When can an old small doctor balance be paid even if below the minimum payout amount?"

describe("evidence quality regressions", () => {
  it("keeps the rule and its constant within top five without filling the page with one file", () => {
    const other = result("configureAccount", "function", 0.59, "configure payout account", 20)
    const rows = flexibleDiversity(rankEvidence(query, [constant, other, helper]), query)
    expect(rows.map((r) => r.metadata.symbolName)).toEqual(["shouldIgnoreMinimumPayout", "MAX_SMALL_BALANCE_AGE_MS"])
  })
  it("retains constant-first ranking for a constant question and respects a strict file cap", () => {
    const rows = rankEvidence("What is the default value of MAX_SMALL_BALANCE_AGE_MS?", [constant, helper])
    expect(rows[0]).toBe(constant)
    expect(diversifyResults(rows, { maxPerFile: 1, maxPerSymbol: 2 })).toHaveLength(1)
  })
  it.each([1200, 4000, 8000])("includes the central rule under a %i token ceiling", (budget) => {
    const peripheral = result("updatePayoutPreferences", "function", 0.63, "minimum payout amount preferences " + "settings ".repeat(400), 1, "preferences.ts")
    const rows = flexibleDiversity(rankEvidence(query, [constant, peripheral, helper]), query)
    const pack = selectWithinTokenBudget(rows, budget, query, 5)
    expect(pack.results.some((r) => r.metadata.symbolName === "shouldIgnoreMinimumPayout")).toBe(true)
    expect(pack.estimatedTokens).toBeLessThanOrEqual(budget)
  })
  it("keeps the already larger context default and accepts an explicit small budget", () => {
    expect(SenseGrepContextParametersSchema.parse({ query }).maxTokens).toBe(12000)
    expect(SenseGrepContextParametersSchema.parse({ query, maxTokens: 1200 }).maxTokens).toBe(1200)
  })
  it("flags unrelated evidence without deleting it, and preserves the assessment in JSON", () => {
    const rows = [result("signMedicalCertificate", "function", 0.8, "sign medical certificates", 1)]
    const assessment = assessEvidence("Kubernetes operator reconciles Kafka partitions and rotates AWS EKS certificates", rows)
    expect(assessment.status).toBe("weak-evidence")
    const projected = projectSearchAgentResponse({ results: rows, answerSufficiency: assessment.status, evidenceAssessment: assessment })
    expect(projected.answerSufficiency).toBe("weak-evidence")
    expect(projected.results).toHaveLength(1)
    expect(projected.evidenceAssessment.calibrated).toBe(false)
  })
  it.each(["Clerk token refresh", "atualizar token de sessao Clerk", "valor MAX_SMALL_BALANCE_AGE_MS"])("does not flag positive support: %s", (text) => {
    expect(assessEvidence(text, [constant, result("refreshClerkToken", "function", 0.5, "Clerk session token refresh", 1)]).status).toBe("not-assessed")
  })
  it("does not treat empty results as proof of repository-wide absence", () => {
    expect(assessEvidence("missing implementation", [])).toMatchObject({ status: "weak-evidence", scope: "returned-candidates", calibrated: false })
  })
  it("does not infer weak evidence from a Portuguese/English vocabulary mismatch", () => {
    const rows = [result("markContextConsumed", "function", 0.8, "return expectedLastBridgeMessageId === lastBridgeMessageId", 1)]
    expect(assessEvidence("Nao apagar contexto de voz se outra mensagem chegou durante o processamento", rows).status).toBe("not-assessed")
  })
  it("preserves five file anchors before admitting supplementary symbols", () => {
    const others = Array.from({ length: 5 }, (_, i) => result(`rule${i}`, "function", 0.5, "minimum payout rule", 1, `rule${i}.ts`))
    const rows = flexibleDiversity(rankEvidence(query, [constant, helper, ...others]), query)
    expect(new Set(rows.slice(0, 5).map((r) => r.file)).size).toBe(5)
    expect(rows.some((r) => r.metadata.symbolName === "MAX_SMALL_BALANCE_AGE_MS")).toBe(true)
  })
  it("retains two functions covering different requested operations in one file", () => {
    const decrypt = result("decryptDestination", "function", 0.7, "function decryptDestination(encrypted) { return encrypted }", 1)
    const encrypt = result("encryptDestination", "function", 0.68, "function encryptDestination(value) { return value }", 10)
    expect(flexibleDiversity([decrypt, encrypt], "encrypt and decrypt destination")).toHaveLength(2)
  })
  it("changes a file's representative without demoting that file below peripheral UI", () => {
    const ui = result("MinimumPayoutScreen", "function", 0.59, "minimum payout amount screen", 1, "screen.ts")
    const rows = rankEvidence(query, [constant, helper, ui])
    expect(rows[0].metadata.symbolName).toBe("shouldIgnoreMinimumPayout")
    expect(rows[0].rerankScore).toBe(constant.semanticScore)
  })
  it("keeps a structurally linked operation just below the general context cutoff", () => {
    const wrapper = result("processTransfer", "function", 0.68, "return decryptPayoutDestination(value)", 1, "transfer.ts")
    const crypto = result("encryptPayoutDestination", "function", 0.47, "function encryptPayoutDestination(value) { return cipher(value) }", 1, "crypto.ts")
    crypto.whyMatched = ["helper expansion: configure.ts:configureTransfer -> encryptPayoutDestination"]
    const noise = result("unrelatedOperation", "function", 0.47, "irrelevant", 1, "noise.ts")
    const pack = selectWithinTokenBudget([wrapper, crypto, noise], 1200, "payout destination encrypted and decrypted before transfers")
    expect(pack.results).toContain(crypto)
    expect(pack.results).not.toContain(noise)
  })
  it("selects a complementary helper before spending the remaining context on a large screen", () => {
    const decrypt = result("decryptPayoutDestination", "function", 0.65, "function decryptPayoutDestination() { return decode() }", 1, "crypto.ts")
    const encrypt = result("encryptPayoutDestination", "function", 0.47, "function encryptPayoutDestination() { return encode() }", 10, "crypto.ts")
    encrypt.whyMatched = ["helper expansion: transfer.ts:configure -> encryptPayoutDestination"]
    const ui = result("PayoutScreen", "function", 0.62, "payout destination encrypt decrypt " + "render screen ".repeat(100), 1, "screen.ts")
    const pack = selectWithinTokenBudget([decrypt, ui, encrypt], 2000, "Where are payout destinations encrypted and decrypted?")
    expect(pack.results.indexOf(encrypt)).toBeGreaterThanOrEqual(0)
    expect(pack.results.indexOf(encrypt)).toBeLessThan(pack.results.indexOf(ui))
  })
})
