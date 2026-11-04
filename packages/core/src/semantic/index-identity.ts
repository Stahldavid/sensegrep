import type { VectorStore } from "./lancedb.js"

/** Describe the generation actually opened. Legacy snapshotId is a generation alias. */
export function describeIndexIdentity(root: string, profile: string, meta: VectorStore.IndexMeta) {
  return {
    root, profile,
    indexGenerationId: meta.tableName ?? "chunks",
    snapshotId: `${meta.tableName ?? "chunks"}:${meta.updatedAt}`,
    snapshotIdScope: "legacy-generation" as const,
    ...(meta.sourceSnapshot ? { repositoryId: meta.sourceSnapshot.manifest.repositoryId, sourceSnapshotId: meta.sourceSnapshot.id } : {}),
    ...(meta.indexSpecHash ? { indexSpecHash: meta.indexSpecHash, indexSpecHashScope: meta.indexSpecHashScope } : {}),
  }
}
