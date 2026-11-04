# @sensegrep/cli

Command-line interface for sensegrep semantic + structural code search.

## Install

```bash
npm install -g @sensegrep/cli
```

When upgrading to 1.20.1 from an older version on Windows, stop active indexers, watchers, MCP servers and daemons for the checkout first. Restart the updated runtimes together. Windows lock keys now normalize case; old and new indexing runtimes must not use the same checkout during the upgrade.

## Quickstart

```bash
sensegrep index --root .
sensegrep status --root .              # fast metadata-only stats
sensegrep status --root . --verify     # freshness check
sensegrep search "error handling and retry logic"
sensegrep search emit --exact --no-shake --include "src/**/*.ts"
sensegrep search "request flow" --purpose understand --json
sensegrep show <result-id> --before 10 --after 20
sensegrep literal "TODO:" --filesystem --max-output-bytes 50000 --json
sensegrep audit "regression risks" --base origin/main --require-coverage --continue-uncovered --max-total-tokens 8000 --max-output-bytes 32000 --max-batches 8
sensegrep investigate "where is access blocked before payment?" --dry-run
sensegrep daemon start
sensegrep daemon call --tool search --arguments '{"query":"request flow","limit":5}'
sensegrep survey "authentication login token" --limit 4
sensegrep cluster "checkout payment order cart" --limit 4
sensegrep detect-duplicates --cross-file-only --timeout 30s
sensegrep semantic-kinds --json
```

`status`, `verify`, search, graph, and indexed literal open existing indexes read-only. `literal --filesystem` and `show` use lightweight paths that do not open the vector table. If the table schema is old, commands report incompatibility and recommend an atomic full rebuild; they never recreate the active table. Search JSON defaults to minified schema v2 `minimal` cards (`id/file/lines/symbol/kind/rank/relevance`), while survey/cluster JSON defaults to actionable `summary`. Use `--json-detail content|representatives|diagnostic|full`, as supported by each command, `--diagnostic`, or `--pretty` to opt into heavier output. Audit `--batch-tokens` is a strict per-batch ceiling, including explicit split ranges from large files. Duplicate JSON omits code unless `--show-code` is set.

`--json` writes parseable JSON to stdout; progress and warnings are written to stderr.
Argument errors under `--json` also use stdout JSON and exit code 2. `--max-output-bytes`
is supported by search/context/audit/literal and enforced against the complete serialized JSON payload. Search requires at least 256 bytes.
Search/context explicitly report `answerSufficiency: "not-assessed"`; diagnostic
`rankingStrength` describes retrieval ranking, not proof that the question is answered.
Hybrid retrieval runs semantic and lexical work concurrently and uses one batched index read
for lexical matches. `--hybrid-mode parallel` is the default; `--no-hybrid` is available for
latency-sensitive semantic-only discovery. Deterministic query embeddings are cached locally
by opaque hash unless `SENSEGREP_QUERY_CACHE=false`.
The daemon is query-only by default; `daemon start --watch` explicitly enables background
incremental indexing.
Use `--log-format none` when a JSON command must suppress all non-fatal logs entirely.
If an `--include`/`--exclude` scope matches no indexed files, JSON output includes a
structured warning instead of failing silently.

## Documentation

- CLI reference: https://github.com/Stahldavid/sensegrep/blob/main/docs/cli-reference.md
- Getting started: https://github.com/Stahldavid/sensegrep/blob/main/docs/getting-started.md
- Issues: https://github.com/Stahldavid/sensegrep/issues

### Reliability in 1.17.1

Search defaults to one result per file; use `--max-per-file 2` for more snippets from each file. `--exact` preserves its two-per-file default and prefers exact symbols rather than excluding approximate matches.

Duplicate JSON respects `--limit`. `summary.outputTruncated` means more groups were found than emitted; raise `--limit` to expose them. A continuation cursor advances the candidate scan, not output pagination. Candidate caps still require raising `--max-candidates` for full coverage.

Incremental `index --no-watch` stages updates before atomically activating the new snapshot, preserving the old index if the process is interrupted. No-change runs avoid copying vectors. Since 1.17.2 this protection also covers individual watcher updates and removals, including files that become non-indexable.

The local daemon publishes a per-instance endpoint record in the user's runtime
directory (`XDG_RUNTIME_DIR`, or a user-specific temporary directory). Clients
validate the protocol, canonical checkout root and instance identifier against
`/health` before sending commands. Stale records are ignored; when multiple live
instances claim one checkout, clients refuse to choose one. Concurrent starts contend on an exclusive per-checkout startup guard. An abrupt
termination can leave that guard behind; startup then fails closed. Inspect the
reported `.start-guard/owner.json`, the process and `daemon status` and ensure
no startup is in progress before manually removing that guard directory. PID
reuse means a PID alone is not proof of ownership; if ownership is uncertain,
leave the guard in place. Graceful stop and SIGTERM remove the guard. A direct
HTTP client must retrieve `/health` and send its `instance` as the
`x-sensegrep-instance` header on POST requests. A daemon started with another
profile is not reused for a requested profile; start a matching daemon instead.

Discovery and startup exclusion apply to processes using the same runtime
directory. Set a common `XDG_RUNTIME_DIR` for clients that should share a daemon.
Daemons from versions using the former derived-port protocol are not discovered
or shut down by this registry; stop them explicitly before migrating.

### Repository identity and indexed source manifest

`repository register <lowercase-uuid> --root <dir>` explicitly binds a checkout to a repository identity. Choose and supply the same identity for another checkout only when you intend to identify it as the same repository. Registration is immutable, stored locally, and does not modify or rebuild an index. Inspect it and the chosen profile with `repository status --root <dir> --profile <name>`, or use `repository manifest` to display the full manifest. These commands return JSON. An unavailable manifest is reported explicitly; registration alone does not make one available. A full index publication may be needed to replace legacy entries without qualified source hashes.

A manifest covers the files represented by the index, not necessarily the full repository, and records hashes rather than retained historical bytes. A matching identity or manifest does not itself authorize remote access or prove that the current checkout still matches it.

### Transfer an indexed source bundle

An explicitly registered checkout with a published source manifest can serve a captured bundle of its indexed files. Place the same independently provisioned secret in `SENSEGREP_SNAPSHOT_TOKEN` on each executor (32–512 printable, non-space ASCII bytes); never put the token in command arguments or share it in logs. On the source, run:

```sh
sensegrep snapshot serve --root /path/to/checkout --profile default
```

The command stays running and emits JSON with the loopback port, repository ID and snapshot ID. Capture uses verified historical source objects retained during indexing. For older indexes without retained objects, it accepts live bytes only when they match the manifest; otherwise capture reports historical source unavailable. The listener only accepts loopback connections and serves one explicitly selected bundle. To cross machines, establish an authorized encrypted tunnel with local forwarding, for example `ssh -N -L 127.0.0.1:LOCAL_PORT:127.0.0.1:SOURCE_PORT user@source-host`, using the chosen local port and the port printed on the source. Do not forward the SSH agent. Keep the tunnel and server running while fetching from the destination:

```sh
sensegrep snapshot fetch --port LOCAL_PORT --repository REPOSITORY_UUID --snapshot sha256:SNAPSHOT_HASH --destination /path/to/private/bundles
```

Fetch verifies the requested identity, manifest and every file hash before writing the bundle to the explicitly chosen directory. It does not activate an index or write into a checkout. Treat the artifact as source code and restrict access to the destination directory. Terminate the server and tunnel when finished. This transfers the indexed-file universe, not necessarily the whole repository; do not use the existing local daemon endpoint as a remote snapshot service.

To create a portable location within the stored bundle, then read it without a network connection or token:

```sh
sensegrep snapshot reference --artifact /path/to/bundle.json --repository REPOSITORY_UUID --snapshot sha256:SNAPSHOT_HASH --file src/example.ts --start 1 --end 5
sensegrep snapshot show --artifact /path/to/bundle.json --repository REPOSITORY_UUID --result RESULT_ID
```

The first command emits a result ID for the specified source lines. It does not establish that the range is a symbol or the result of a search. The second validates the ID, repository, snapshot and bytes against the selected artifact before returning the content.

Fetched artifacts use the `source-replica-v1` descriptor format: manifests refer to verified content-addressed files in the destination's `.replica-objects/sha256` directory. Snapshots in one destination reuse identical objects, and subsequent fetches request only objects that are not already available and verified there. Each destination is bound to one explicit repository identity.

Pin a snapshot that must survive replica retention, release its pin when it is no longer needed, or collect replica data under the configured policy:

```sh
sensegrep snapshot pin --artifact /path/to/bundle.json --repository REPOSITORY_UUID --snapshot sha256:SNAPSHOT_HASH
sensegrep snapshot unpin --artifact /path/to/bundle.json --repository REPOSITORY_UUID --snapshot sha256:SNAPSHOT_HASH
sensegrep snapshot gc --destination /path/to/private/bundles --repository REPOSITORY_UUID --retain-snapshots 8 --max-bytes 536870912
```

These operations require no transport token. Pin and unpin validate the selected replica artifact's repository, snapshot identity and content before changing its pin. GC validates the destination's repository binding before applying retention. An unpinned snapshot becomes eligible for normal retention rather than being deleted immediately. `--retain-snapshots` must be at least one; explicitly pinned snapshots remain protected in addition to that count. `--max-bytes` sets the source-object budget for that operation, and the command fails if protected snapshots cannot fit. It never removes a pinned snapshot to satisfy the budget. Without explicit limits, GC uses `SENSEGREP_REPLICA_MAX_BYTES` and `SENSEGREP_REPLICA_RETAIN_SNAPSHOTS` (defaults: 512 MiB and eight snapshots).

### Release local worktree views

When a worktree no longer needs its local index, release the selected view and then collect previously released views through a remaining registered checkout:

```sh
sensegrep repository release --root /original/path/to/old-worktree --profile default
sensegrep repository gc --root /path/to/remaining-registered-checkout --profile default
```

`release` uses the original absolute checkout path even if that worktree directory has already been removed. It releases only the selected profile's index view; it does not delete checkout source files or change repository registration. Tables that are still required by other copy-on-write views or reader references remain retained, and JSON output reports their count. Repeated release is safe and retries physical reclamation; inspect the returned retained-table count. Background watchers do not recreate a released view until an explicit indexing operation resumes it. Use the original canonical path when the former checkout was accessed through a symbolic-link alias, since an alias that no longer exists cannot be resolved.

`gc` requires an existing, explicitly registered checkout. It collects released views in that repository and selected profile, preserving any remaining references. Its JSON output reports collected views and retained tables. It does not implicitly release an active view or another profile. These local operations use no embedding provider and require no snapshot transport token.

Shared copy-on-write views require repository registration and `SENSEGREP_SHARED_OBJECTS=1`. See [shared worktree indexes](../../docs/shared-worktree-indexes.md) for compatibility checks, native cache limits, checkpoints, storage budgets and replica retention.
