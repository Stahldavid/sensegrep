import { afterEach, describe, expect, it, vi } from "vitest"
import { sendJevRequest, parseRetryAfter } from "./jev-transport.js"
import { getNetworkPolicy, assertNetworkAllowed } from "../util/network-policy.js"
const endpoint="https://openrouter.ai/api/v1/systemone"
afterEach(()=>vi.unstubAllEnvs())
const options=(fetcher:typeof fetch)=>({apiKey:"synthetic-test-credential",signal:AbortSignal.timeout(2000),fetch:fetcher,onAttempt:()=>{}})
describe("Jev bounded transport",()=>{
  it("does not split/retry arbitrary HTTP 400",async()=>{
    const fetcher=vi.fn(async()=>Response.json({error:{code:"bad_question"}},{status:400}))
    await expect(sendJevRequest(endpoint,"{}",options(fetcher))).rejects.toMatchObject({code:"invalid-request"})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("identifies actual context overflow",async()=>{
    await expect(sendJevRequest(endpoint,"{}",options(async()=>Response.json({error:{code:"context_length_exceeded"}},{status:400})))).rejects.toMatchObject({code:"context-overflow"})
  })
  it("never retries authentication or credit rejection",async()=>{
    for(const status of [401,402,403]) {
      const fetcher=vi.fn(async()=>new Response("",{status}))
      await expect(sendJevRequest(endpoint,"{}",options(fetcher))).rejects.toMatchObject({code:`provider-rejected-${status}`})
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it("retries a transient response within the same deadline",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response("",{status:503,headers:{"retry-after":"0"}})).mockResolvedValueOnce(Response.json({answers:{}}))
    await expect(sendJevRequest(endpoint,"{}",options(fetcher))).resolves.toEqual({answers:{}})
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it("does not shorten a long Retry-After into another request",async()=>{
    const fetcher=vi.fn(async()=>new Response("",{status:429,headers:{"retry-after":"60"}}))
    await expect(sendJevRequest(endpoint,"{}",options(fetcher))).rejects.toMatchObject({code:"provider-rejected-429"})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("blocks remote inference in local-only mode",async()=>{
    vi.stubEnv("SENSEGREP_NETWORK_POLICY","local-only")
    const fetcher=vi.fn()
    await expect(sendJevRequest(endpoint,"{}",options(fetcher))).rejects.toThrow(/local-only/)
    expect(fetcher).not.toHaveBeenCalled()
    expect(()=>assertNetworkAllowed("http://127.0.0.1:11434")).not.toThrow()
    expect(()=>assertNetworkAllowed("https://127.0.0.1.evil.invalid")).toThrow()
    expect(()=>getNetworkPolicy({SENSEGREP_NETWORK_POLICY:"typo"})).toThrow()
  })
  it("parses Retry-After seconds and dates",()=>{
    expect(parseRetryAfter("2",0)).toBe(2000)
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT",0)).toBe(5000)
  })
})
