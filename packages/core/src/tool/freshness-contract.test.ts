import {afterEach,describe,expect,it,vi} from "vitest"
vi.mock("../semantic/indexer.js",()=>({Indexer:{verifyIndex:vi.fn()}}))
import {Indexer} from "../semantic/indexer.js"
import {getFreshnessSummary,formatFreshnessWarning} from "./sensegrep-pipeline.js"
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks()})
describe("index freshness contract",()=>{
  it("reports unknown when verification fails",async()=>{
    vi.mocked(Indexer.verifyIndex).mockRejectedValue(new Error("fixture read failure"))
    const result=await getFreshnessSummary()
    expect(result.status).toBe("unknown")
    expect(result.reason).toBe("verification-failed")
    expect(formatFreshnessWarning(result)).toContain("unknown")
  })
  it("reports unknown rather than fresh on timeout",async()=>{
    vi.useFakeTimers()
    vi.mocked(Indexer.verifyIndex).mockImplementation(()=>new Promise(()=>{}))
    const pending=getFreshnessSummary()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toMatchObject({status:"unknown",reason:"verification-timeout"})
  })
  it("propagates caller cancellation",async()=>{
    const controller=new AbortController();controller.abort(new Error("cancelled"))
    await expect(getFreshnessSummary(controller.signal)).rejects.toThrow("cancelled")
    expect(Indexer.verifyIndex).not.toHaveBeenCalled()
  })
})
