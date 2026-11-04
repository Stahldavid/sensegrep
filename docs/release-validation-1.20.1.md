# Path identity patch: 1.20.1

The full hosted matrix for [1.20.0](release-validation-1.20.0.md) exposed failures on Windows and macOS after the Linux release checks passed. The patch resolves checkout aliases consistently across operation context, storage lookup and repository accounting. Windows lock keys also normalize case, while displayed paths preserve filesystem spelling.

Before upgrading on Windows, stop existing indexers, watchers, MCP servers and daemons that use the affected checkout; restart them with the new runtime. Older versions use a different lock hash. The new runtime never treats an older process's lock as proof that its owner is dead. Do not run old and new indexing runtimes against the same checkout during this upgrade.

Existing alias-bound stores are discovered without copying or moving native database files. An active canonical store remains authoritative. An empty canonical directory or one containing only staging files does not hide a published legacy store. When fallback finds multiple legacy candidates, it refuses to choose and reports their paths for recovery. Canonicalization uses the nearest existing ancestor so retained views remain accessible after their checkout is removed. Permissions failures propagate rather than being treated as missing directories.

The old weak directory hash is no longer sufficient to adopt storage. Legacy metadata must establish the matching checkout and profile; unrelated or unverifiable data is preserved without reuse.

Automated regressions cover parent-index lookup through aliases, legacy storage and ambiguity, interrupted staging, removed-checkout release, retained-storage admission, profile inheritance and overlapping mutations. Windows short-path spellings, macOS temporary-directory aliases and platform path separators are covered by the restored full CI matrix and platform-correct fixtures. Embeddings in these tests are simulated locally; no paid provider is used.

The release adapter also translates Changesets 3 generated-tag events for the existing GitHub action, so npm publication and its GitHub tags/releases remain correlated. The wrapper preserves failure status and validates events instead of inferring success from terminal output.

Local validation and hosted matrix results are recorded separately. Publishing 1.20.1 waits for the corrected full matrix; the prior 1.20.0 npm publication is already confirmed.

## Local candidate validation

On Ubuntu WSL with Node 24.16.0, the candidate passed build, all workspace type checks, version consistency, 539 Vitest tests in 83 files, 76 native Node contracts and 26 Python tests. Four isolated XDG directories and a non-loopback socket guard protected engine tests from personal configuration and external inference. The separate local VS Code extension-host test passed with isolated configuration.

Fresh 1.20.1 tarballs installed into an empty consumer and passed the two-worktree/two-CLI-process smoke: one deterministic loopback embedding request, shared source inodes, a protected base while needed, and zero retained tables after release and collection. Package layouts and affected documentation links passed. Dependency audit remains at zero vulnerabilities; this patch changes no resolved dependency versions. None of these local checks replace the pending Windows/macOS hosted runs.
