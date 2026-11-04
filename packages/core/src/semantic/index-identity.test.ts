import { expect, it } from "vitest"
import { describeIndexIdentity } from "./index-identity.js"
import type { VectorStore } from "./lancedb.js"

it("distinguishes physical generation, content and recipe without inventing legacy provenance", () => {
  const meta: VectorStore.IndexMeta = { root: "/copy", version: 1, updatedAt: 7, tableName: "chunks_a", embeddings: { provider: "test", dimension: 2 }, files: {} }
  const legacy = describeIndexIdentity("/copy", "alpha", meta)
  expect(legacy).toMatchObject({ root: "/copy", profile: "alpha", indexGenerationId: "chunks_a", snapshotId: "chunks_a:7", snapshotIdScope: "legacy-generation" })
  expect(legacy).not.toHaveProperty("sourceSnapshotId")
  const sourceSnapshot = { id: `sha256:${"a".repeat(64)}`, manifest: { version: 1 as const, repositoryId: "00000000-0000-0000-0000-000000000000", universe: "indexed-files" as const, files: [] } }
  expect(describeIndexIdentity("/copy", "alpha", { ...meta, sourceSnapshot })).toMatchObject({ sourceSnapshotId: sourceSnapshot.id, repositoryId: sourceSnapshot.manifest.repositoryId, indexGenerationId: "chunks_a" })
})
