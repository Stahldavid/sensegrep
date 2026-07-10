import type { Flags } from "./search-commands.js"

export function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }

    const [rawKey, rawValue] = arg.slice(2).split("=", 2)
    if (rawValue !== undefined) {
      flags[rawKey] = rawValue
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[rawKey] = next
      i++
    } else {
      flags[rawKey] = true
    }
  }
  return { flags, positional }
}

const GLOBAL_FLAGS = new Set(["help", "h", "root", "profile", "json", "log-format"])
const EMBEDDING_FLAGS = new Set(["provider", "embed-model", "embedModel", "embed-dim", "embedDim"])
const INDEX_RUN_FLAGS = new Set(["timeout", "max-files", "maxFiles", "verbose"])
const SEARCH_FILTER_FLAGS = new Set([
  "query", "pattern", "limit", "include", "exclude", "type", "symbolType", "variant", "decorator",
  "symbol", "name", "exact", "exported", "async", "static", "abstract", "min-complexity",
  "minComplexity", "max-complexity", "maxComplexity", "min-score", "minScore", "max-per-file",
  "maxPerFile", "max-per-symbol", "maxPerSymbol", "has-docs", "hasDocs", "language", "parent",
  "parentScope", "imports", "rerank", "no-rerank", "semantic-kind", "semanticKind", "explain-filters",
  "explainFilters", "strict-parent", "strictParent", "strict-imports", "strictImports", "ensure-fresh",
  "ensureFresh", "no-shake", "hybrid", "no-hybrid", "max-tokens", "maxTokens", "changed", "base",
])

const ALLOWED_FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  index: new Set([
    ...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, "full", "incremental", "verify", "check",
    "watch", "no-watch", "include-docs", "include-config", "max-changed", "max-missing", "max-removed", "dry-run", "resume", "no-resume",
  ]),
  verify: new Set([...GLOBAL_FLAGS, "strict"]),
  status: new Set([...GLOBAL_FLAGS, "verbose", "verify"]),
  search: new Set([...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS]),
  context: new Set([...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS]),
  audit: new Set([...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS]),
  survey: new Set([
    ...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS,
    "raw-limit", "rawLimit", "per-group", "perGroup",
  ]),
  cluster: new Set([
    ...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS,
    "raw-limit", "rawLimit", "per-cluster", "perCluster", "cluster-threshold", "clusterThreshold",
    "min-cluster-size", "minClusterSize",
  ]),
  "detect-duplicates": new Set([
    ...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, "ensure-fresh", "ensureFresh", "threshold",
    "scope", "language", "include", "exclude", "cross-language", "ignore-tests", "cross-file-only",
    "only-exported", "exclude-pattern", "min-lines", "min-complexity", "max-candidates",
    "ignore-acceptable-patterns", "normalize-identifiers", "no-normalize-identifiers", "rank-by-impact",
    "no-rank-by-impact", "limit", "full-code", "show-code", "verbose", "quiet",
  ]),
  languages: new Set([...GLOBAL_FLAGS, "detect", "variants"]),
  "semantic-kinds": new Set(GLOBAL_FLAGS),
  selftest: new Set([...GLOBAL_FLAGS, "strict", "deep"]),
  benchmark: new Set([...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, "concurrency", "samples", "repeats"]),
  references: new Set([...GLOBAL_FLAGS, "limit", "max-documents"]),
  impact: new Set([...GLOBAL_FLAGS, "limit", "depth", "max-documents"]),
  trace: new Set([...GLOBAL_FLAGS, "depth", "max-documents"]),
  profiles: new Set(GLOBAL_FLAGS),
}

export function validateKnownFlags(command: string, flags: Flags): string | undefined {
  const allowed = ALLOWED_FLAGS_BY_COMMAND[command]
  return allowed ? Object.keys(flags).find((key) => !allowed.has(key)) : undefined
}
