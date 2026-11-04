# Legacy cleanup decisions

The unused `scripts/runtime-smoke.mjs` was removed. It belonged to a proposed runtime-only Node 20 CI profile. The current [CI workflow](../.github/workflows/ci.yml) runs the full build, typecheck, unit tests, native contracts and packaged-artifact checks on Node 20, 22 and 24; no workflow, package script or source file referenced the removed script. Packaged-artifact validation remains in `npm run release:verify`.

`VectorStore.getOrCreateCollection` has no consumers in this repository, but is exported through the public `VectorStore` namespace. Removing it in a minor release would break external callers. It remains for compatibility. New indexing code stages a separate generation and publishes it atomically; new code should not use this helper to mutate the active generation.

The following compatibility paths remain necessary:

- Full-copy collection creation provides nonshared indexing and bounded-depth COW checkpoints.
- `deleteCollection` implements logical index-view release and remains used by the editor extension.
- Recent-project lookup remains available in the editor's explicit index-root selection; watchers do not select a global recent project.
- Older index-directory bindings, result IDs and snapshot protocol v1 remain readable without inferring modern content provenance.

Private evaluation artifacts and personal model/configuration directories are outside this cleanup and remain untouched. Historical validation records remain historical evidence; the current [shared-worktree contract](shared-worktree-indexes.md) describes the architecture.
