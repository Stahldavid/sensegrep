import { describe, expect, it } from "vitest"
import { VectorStore } from "./lancedb.js"

describe("VectorStore distance scoring", () => {
  it("converts l2 distance between normalized vectors back to cosine similarity", () => {
    const cosineSimilarity = 0.3
    const l2Distance = Math.sqrt(2 - 2 * cosineSimilarity)

    expect(VectorStore.distanceToSimilarity(l2Distance, "l2")).toBeCloseTo(cosineSimilarity, 6)
  })

  it("uses cosine distance as the default score conversion", () => {
    expect(VectorStore.distanceToSimilarity(0.28)).toBeCloseTo(0.72, 6)
    expect(VectorStore.DEFAULT_DISTANCE_METRIC).toBe("cosine")
  })
})
