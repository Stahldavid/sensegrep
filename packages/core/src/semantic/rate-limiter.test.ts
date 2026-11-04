import { describe, expect, it } from "vitest"
import { RateLimiter, quotaLimiter, validateEmbeddingIndices } from "./rate-limiter.js"

describe("bounded embedding quota queues", () => {
  it("rejects an impossible batch instead of waiting forever", async () => {
    await expect(new RateLimiter(10, 10).acquire(11)).rejects.toThrow(/capacity/)
  })
  it("cancels a queued request and does not charge it", async () => {
    const limiter = new RateLimiter(1, 10, 20)
    await limiter.acquire(1)
    const controller = new AbortController()
    const pending = limiter.acquire(1, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    await expect(limiter.acquire(1, { deadlineAt: Date.now() + 1000 })).resolves.toBeUndefined()
  })
  it("expires queued requests against the original deadline", async () => {
    const limiter = new RateLimiter(1, 10)
    await limiter.acquire(1)
    await expect(limiter.acquire(1, { deadlineAt: Date.now() + 5 })).rejects.toMatchObject({ name: "TimeoutError" })
  })
  it("shares only the same quota identity", async () => {
    const a = quotaLimiter({ provider: "test", endpoint: "a", credential: "one" }, 10, 100)
    await a.acquire(1)
    expect(quotaLimiter({ provider: "test", endpoint: "a", credential: "one" }, 10, 100)).toBe(a)
    expect(quotaLimiter({ provider: "test", endpoint: "a", credential: "two" }, 10, 100)).not.toBe(a)
  })
  it("requires unique complete input indices and numeric coordinates", () => {
    expect(validateEmbeddingIndices([{index:1,embedding:[1]},{index:0,embedding:[2]}],2).map(r=>r.index)).toEqual([0,1])
    expect(()=>validateEmbeddingIndices([{index:0,embedding:[1]},{index:0,embedding:[2]}],2)).toThrow(/index/)
    expect(()=>validateEmbeddingIndices([{index:0,embedding:["1"]}],1)).toThrow(/finite/)
  })
  it("does not reset an account quota when another caller changes limits", async () => {
    const identity={provider:'limit-change-test',credential:'synthetic'}
    const original=quotaLimiter(identity,1,100)
    await original.acquire(1)
    const changed=quotaLimiter(identity,100,1000)
    expect(changed).toBe(original)
    await expect(changed.acquire(1,{deadlineAt:Date.now()+5})).rejects.toMatchObject({name:'TimeoutError'})
  })
})
