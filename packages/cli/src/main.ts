#!/usr/bin/env node
import type { DuplicateDetector as DuplicateDetectorType } from "@sensegrep/core"
import { readFileSync } from "node:fs"
import { createHumanLogger, writeJson, writeStderrLine, writeStdoutLine } from "./output.js"
import { CLI_USAGE } from "./usage.js"
import {
  assignNumberParam,
  buildCommonSearchParams,
  executeSearchLikeTool,
  getSearchQuery,
  toBool,
  type Flags,
} from "./search-commands.js"

class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CliUsageError"
  }
}

function parseRequiredNumberFlag(flags: Flags, name: string, options: { min?: number; max?: number } = {}): number | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (options.min !== undefined && parsed < options.min) || (options.max !== undefined && parsed > options.max)) {
    const range = options.min !== undefined && options.max !== undefined
      ? ` between ${options.min} and ${options.max}`
      : options.min !== undefined
        ? ` greater than or equal to ${options.min}`
        : ""
    throw new CliUsageError(`--${name} must be a number${range}`)
  }
  return parsed
}

function parsePositiveIntegerFlag(flags: Flags, name: string): number | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`--${name} must be a positive integer`)
  }
  return parsed
}

type CoreModule = typeof import("@sensegrep/core")

let corePromise: Promise<CoreModule> | null = null

function getCliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : "unknown"
  } catch {
    return "unknown"
  }
}

async function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    corePromise = import("@sensegrep/core").catch(async (error) => {
      const fallbackUrl = new URL("../../core/dist/index.js", import.meta.url).href
      try {
        return await import(fallbackUrl)
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        const err = new Error(`Failed to load @sensegrep/core. Fallback also failed: ${message}`)
        ;(err as any).cause = error
        throw err
      }
    })
  }
  return corePromise
}

function usage() {
  writeStdoutLine(CLI_USAGE)
}

function parseArgs(argv: string[]) {
  const flags: Flags = {}
  const positional: string[] = []
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const [rawKey, rawValue] = arg.slice(2).split("=", 2)
      if (rawValue !== undefined) {
        flags[rawKey] = rawValue
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith("--")) {
          flags[rawKey] = next
          i += 1
        } else {
          flags[rawKey] = true
        }
      }
    } else {
      positional.push(arg)
    }
    i += 1
  }
  return { flags, positional }
}

const GLOBAL_FLAGS = new Set(["help", "h", "root", "json"])
const EMBEDDING_FLAGS = new Set(["provider", "embed-model", "embedModel", "embed-dim", "embedDim"])
const INDEX_RUN_FLAGS = new Set(["timeout", "max-files", "maxFiles", "log-format", "verbose"])
const SEARCH_FILTER_FLAGS = new Set([
  "query",
  "pattern",
  "limit",
  "include",
  "exclude",
  "type",
  "symbolType",
  "variant",
  "decorator",
  "symbol",
  "name",
  "exact",
  "exported",
  "async",
  "static",
  "abstract",
  "min-complexity",
  "minComplexity",
  "max-complexity",
  "maxComplexity",
  "min-score",
  "minScore",
  "max-per-file",
  "maxPerFile",
  "max-per-symbol",
  "maxPerSymbol",
  "has-docs",
  "hasDocs",
  "language",
  "parent",
  "parentScope",
  "imports",
  "rerank",
  "no-rerank",
  "semantic-kind",
  "semanticKind",
  "explain-filters",
  "explainFilters",
  "strict-parent",
  "strictParent",
  "strict-imports",
  "strictImports",
  "ensure-fresh",
  "ensureFresh",
  "no-shake",
])

const ALLOWED_FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  index: new Set([
    ...GLOBAL_FLAGS,
    ...EMBEDDING_FLAGS,
    ...INDEX_RUN_FLAGS,
    "full",
    "incremental",
    "verify",
    "check",
    "watch",
    "no-watch",
    "include-docs",
    "include-config",
    "max-changed",
    "max-missing",
    "max-removed",
  ]),
  verify: new Set([...GLOBAL_FLAGS, "strict"]),
  status: new Set([...GLOBAL_FLAGS, "verbose", "verify"]),
  search: new Set([...GLOBAL_FLAGS, ...EMBEDDING_FLAGS, ...INDEX_RUN_FLAGS, ...SEARCH_FILTER_FLAGS]),
  survey: new Set([
    ...GLOBAL_FLAGS,
    ...EMBEDDING_FLAGS,
    ...INDEX_RUN_FLAGS,
    ...SEARCH_FILTER_FLAGS,
    "raw-limit",
    "rawLimit",
    "per-group",
    "perGroup",
  ]),
  cluster: new Set([
    ...GLOBAL_FLAGS,
    ...EMBEDDING_FLAGS,
    ...INDEX_RUN_FLAGS,
    ...SEARCH_FILTER_FLAGS,
    "raw-limit",
    "rawLimit",
    "per-cluster",
    "perCluster",
    "cluster-threshold",
    "clusterThreshold",
    "min-cluster-size",
    "minClusterSize",
  ]),
  "detect-duplicates": new Set([
    ...GLOBAL_FLAGS,
    ...EMBEDDING_FLAGS,
    ...INDEX_RUN_FLAGS,
    "ensure-fresh",
    "ensureFresh",
    "threshold",
    "scope",
    "language",
    "include",
    "exclude",
    "cross-language",
    "ignore-tests",
    "cross-file-only",
    "only-exported",
    "exclude-pattern",
    "min-lines",
    "min-complexity",
    "max-candidates",
    "ignore-acceptable-patterns",
    "normalize-identifiers",
    "no-normalize-identifiers",
    "rank-by-impact",
    "no-rank-by-impact",
    "limit",
    "full-code",
    "show-code",
    "verbose",
    "quiet",
  ]),
  languages: new Set([...GLOBAL_FLAGS, "detect", "variants"]),
  "semantic-kinds": new Set(GLOBAL_FLAGS),
  selftest: new Set([...GLOBAL_FLAGS, "strict", "deep"]),
}

function validateKnownFlags(command: string, flags: Flags): string | undefined {
  const allowed = ALLOWED_FLAGS_BY_COMMAND[command]
  if (!allowed) return undefined
  return Object.keys(flags).find((key) => !allowed.has(key))
}

function applyEmbeddingOverrides(flags: Flags, Embeddings: CoreModule["Embeddings"]) {
  const overrides: Record<string, unknown> = {}
  const provider = flags.provider ? String(flags.provider).toLowerCase() : undefined

  if (flags.device || flags["rerank-model"] || flags.rerankModel) {
    throw new Error("Device and reranker overrides were removed. Use Ollama, Gemini, OpenAI-compatible, or Bedrock embeddings only.")
  }
  if (provider && provider !== "gemini" && provider !== "openai" && provider !== "bedrock" && provider !== "ollama") {
    throw new Error(`Unsupported provider "${provider}". Use --provider ollama, --provider gemini, --provider openai, or --provider bedrock.`)
  }
  if (flags["embed-model"]) overrides.embedModel = String(flags["embed-model"])
  if (flags.embedModel) overrides.embedModel = String(flags.embedModel)
  if (flags["embed-dim"]) overrides.embedDim = Number(flags["embed-dim"])
  if (flags.embedDim) overrides.embedDim = Number(flags.embedDim)
  if (provider) overrides.provider = provider

  if (Object.keys(overrides).length > 0) {
    Embeddings.configure(overrides as any)
  }
}

type IndexResult =
  | Awaited<ReturnType<CoreModule["Indexer"]["indexProject"]>>
  | Awaited<ReturnType<CoreModule["Indexer"]["indexProjectIncremental"]>>

type DuplicateDetectOptions = DuplicateDetectorType.DetectOptions

function isIncremental(
  result: IndexResult,
): result is Awaited<ReturnType<CoreModule["Indexer"]["indexProjectIncremental"]>> {
  return (result as any).mode === "incremental"
}

function formatIndexResult(result: IndexResult): string {
  const duration = ((result.duration ?? 0) / 1000).toFixed(1)
  if (isIncremental(result)) {
    return `Indexed ${result.files} files (${result.chunks} chunks), skipped ${result.skipped}, removed ${result.removed} in ${duration}s`
  }
  return `Indexed ${result.files} files (${result.chunks} chunks) in ${duration}s`
}

function parseDurationMs(value: string | boolean | undefined): number | undefined {
  if (value === undefined || value === false || value === true) return undefined
  const raw = String(value).trim().toLowerCase()
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/)
  if (!match) throw new Error(`Invalid duration "${value}". Use 30000ms, 30s, or 5m.`)
  const amount = Number(match[1])
  const unit = match[2] ?? "s"
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid duration "${value}"`)
  if (unit === "ms") return Math.ceil(amount)
  if (unit === "m") return Math.ceil(amount * 60_000)
  return Math.ceil(amount * 1000)
}

function parsePositiveIntFlag(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined || value === false || value === true) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`)
  return parsed
}

function isIndexStale(
  verify: Awaited<ReturnType<CoreModule["Indexer"]["verifyIndex"]>>,
  thresholds?: { maxChanged?: number; maxMissing?: number; maxRemoved?: number },
) {
  const maxChanged = thresholds?.maxChanged ?? 0
  const maxMissing = thresholds?.maxMissing ?? 0
  const maxRemoved = thresholds?.maxRemoved ?? 0
  return (
    !verify.indexed ||
    verify.changed > maxChanged ||
    verify.missing > maxMissing ||
    verify.removed > maxRemoved ||
    (verify as any).chunkMismatch === true
  )
}

function formatVerifySummary(verify: Awaited<ReturnType<CoreModule["Indexer"]["verifyIndex"]>>) {
  return `indexed=${verify.indexed} changed=${verify.changed} missing=${verify.missing} removed=${verify.removed} chunkMismatch=${(verify as any).chunkMismatch === true ? `${(verify as any).actualChunks}/${(verify as any).expectedChunks}` : "false"}`
}

function createIndexRunOptions(flags: Flags): {
  timeoutMs?: number
  maxFiles?: number
  onProgress?: (progress: any) => void
} {
  const timeoutMs = parseDurationMs(flags.timeout)
  const maxFiles = parsePositiveIntFlag(flags["max-files"] ?? flags.maxFiles, "max-files")
  const logFormat = flags["log-format"] ? String(flags["log-format"]).toLowerCase() : undefined
  if (logFormat && !["jsonl", "none"].includes(logFormat)) {
    throw new Error('--log-format must be "jsonl" or "none"')
  }

  let lastHumanProgress = 0
  const verbose = toBool(flags.verbose) ?? false
  const onProgress = (progress: any) => {
    if (logFormat === "none") return
    const now = Date.now()
    const isTerminal = progress.phase === "complete" || progress.phase === "error"
    const isPhaseBoundary = progress.current === 0 || progress.current === progress.total
    if (!verbose && !isTerminal && !isPhaseBoundary && now - lastHumanProgress < 2_000) return
    lastHumanProgress = now

    if (logFormat === "jsonl") {
      process.stderr.write(JSON.stringify({ type: "index-progress", ...progress, at: new Date().toISOString() }) + "\n")
      return
    }

    const total = Number(progress.total ?? 0)
    const current = Number(progress.current ?? 0)
    const count = total > 0 ? `${current}/${total}` : String(current)
    const message = progress.message ? ` ${progress.message}` : ""
    const details = [
      progress.filesParsed !== undefined ? `filesParsed=${progress.filesParsed}` : undefined,
      progress.chunksPrepared !== undefined ? `chunksPrepared=${progress.chunksPrepared}` : undefined,
      progress.chunksEmbedded !== undefined ? `chunksEmbedded=${progress.chunksEmbedded}` : undefined,
      progress.chunksPersisted !== undefined ? `chunksPersisted=${progress.chunksPersisted}` : undefined,
      progress.skipped !== undefined ? `skipped=${progress.skipped}` : undefined,
      progress.failed !== undefined ? `failed=${progress.failed}` : undefined,
    ].filter(Boolean).join(" ")
    process.stderr.write(`[sensegrep:index] ${progress.phase} ${count}${message}${details ? ` ${details}` : ""}\n`)
  }

  return { timeoutMs, maxFiles, onProgress }
}

async function ensureFreshIfRequested(
  flags: Flags,
  rootDir: string,
  Instance: CoreModule["Instance"],
  Indexer: CoreModule["Indexer"],
) {
  const raw = flags["ensure-fresh"] ?? flags.ensureFresh
  if (raw === undefined) return

  const mode = raw === true ? "check" : String(raw).toLowerCase()
  if (!["check", "incremental", "full"].includes(mode)) {
    throw new Error('--ensure-fresh must be one of "check", "incremental", or "full"')
  }

  const verify = await Instance.provide({
    directory: rootDir,
    fn: () => Indexer.verifyIndex(),
  })
  if (!isIndexStale(verify)) return

  if (mode === "check") {
    throw new Error(`Index is stale: ${formatVerifySummary(verify)}. Run sensegrep index --no-watch or use --ensure-fresh incremental.`)
  }

  const result = await Instance.provide({
    directory: rootDir,
    fn: () => (mode === "full" ? Indexer.indexProject(createIndexRunOptions(flags)) : Indexer.indexProjectIncremental(createIndexRunOptions(flags))),
  })
  writeStderrLine(`Refreshed stale index before query: ${formatIndexResult(result)}`)
}

async function run() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const { flags, positional } = parseArgs(argv.slice(1))

  if (!command || command === "--help" || command === "-h" || flags.help || flags.h) {
    usage()
    return
  }

  if (command === "--version" || command === "-v" || command === "version") {
    writeStdoutLine(getCliVersion())
    return
  }

  const unknownFlag = validateKnownFlags(command, flags)
  if (unknownFlag) {
    writeStderrLine(`Unknown option for "${command}": --${unknownFlag}`)
    process.exitCode = 1
    return
  }

  const {
    SenseGrepTool,
    SenseGrepSurveyTool,
    SenseGrepClusterTool,
    Indexer,
    IndexWatcher,
    Instance,
    Embeddings,
    DuplicateDetector,
    Log,
  } = await loadCore()

  // Configure log level: WARN by default, INFO if --verbose
  const logLevel = toBool(flags.verbose) ? "INFO" : "WARN"
  await Log.init({ print: true, level: logLevel as any })

  const rootDir = (flags.root as string | undefined) || process.cwd()
  applyEmbeddingOverrides(flags, Embeddings)

  if (command === "index") {
    const full = flags.full === true
    const checkOnly = flags.check === true
    const noWatch = flags["no-watch"] === true
    const watch = noWatch || flags.json ? false : (toBool(flags.watch) ?? true)
    const includeDocs = flags["include-docs"] === true
    const includeConfig = flags["include-config"] === true
    const humanLog = createHumanLogger({ json: flags.json === true })
    const indexRunOptions = createIndexRunOptions(flags)

    // Configure index options
    const { Indexer } = await loadCore()
    Indexer.setIndexOptions({ includeDocs, includeConfig })

    if (checkOnly) {
      const verify = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      })
      const maxChanged = flags["max-changed"] !== undefined ? Number(flags["max-changed"]) : undefined
      const maxMissing = flags["max-missing"] !== undefined ? Number(flags["max-missing"]) : undefined
      const maxRemoved = flags["max-removed"] !== undefined ? Number(flags["max-removed"]) : undefined
      const stale = isIndexStale(verify, { maxChanged, maxMissing, maxRemoved })
      const payload = {
        ...verify,
        isStale: stale,
        thresholds: {
          maxChanged: maxChanged ?? 0,
          maxMissing: maxMissing ?? 0,
          maxRemoved: maxRemoved ?? 0,
        },
      }
      if (flags.json) {
        writeJson(payload)
      } else {
        writeStdoutLine(`Index check: ${formatVerifySummary(verify)} stale=${stale}`)
      }
      process.exitCode = stale ? 1 : 0
      return
    }

    // Auto-detect languages if not specified
    const { detectProjectLanguages } = await loadCore()
    const detected = await detectProjectLanguages(rootDir)
    if (detected.length > 0) {
      const langSummary = detected.map((d: any) => `${d.language} (${d.fileCount})`).join(", ")
      humanLog(`Detected: ${langSummary}`)
    }

    let skipIndex = false
    let result: IndexResult | undefined
    if (flags.verify === true) {
      const check = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      })
      humanLog(`Verify: ${formatVerifySummary(check)}`)
      if (
        check.indexed &&
        check.changed === 0 &&
        check.missing === 0 &&
        check.removed === 0 &&
        (check as any).chunkMismatch !== true &&
        !full
      ) {
        humanLog("Index is up to date. Skipping.")
        skipIndex = true
      }
    }
    if (!skipIndex) {
      result = await Instance.provide({
        directory: rootDir,
        fn: () =>
          full ? Indexer.indexProject(indexRunOptions) : Indexer.indexProjectIncremental(indexRunOptions),
      })
      humanLog(formatIndexResult(result))
    }
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    const summary = {
      result,
      stats,
      skipped: skipIndex,
      detectedLanguages: detected,
    }
    if (flags.json) {
      writeJson(summary)
    } else {
      writeStdoutLine(
        `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}`,
      )
    }
    if (watch) {
      writeStdoutLine("Watching for changes (reindex at most once per minute)... Use --no-watch to disable.")
      const handle = await IndexWatcher.start({
        rootDir,
        entrypoint: "cli",
        intervalMs: 60_000,
        onIndex: (result) => {
          writeStdoutLine(formatIndexResult(result))
        },
      })
      const stop = async () => {
        await handle.stop()
        process.exit(0)
      }
      process.on("SIGINT", stop)
      process.on("SIGTERM", stop)
      await new Promise(() => {})
    }
    return
  }

  if (command === "status") {
    const verbose = flags.verbose === true
    const verifyFreshness = verbose || flags.verify === true
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    const output: Record<string, unknown> = {
      ...stats,
      freshnessChecked: false,
      isStale: stats.chunkMismatch === true ? true : null,
    }
    if (verifyFreshness) {
      const verify = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      })
      output.freshnessChecked = true
      output.changed = (verify as any).changed
      output.missing = (verify as any).missing
      output.removed = (verify as any).removed
      output.expectedChunks = (verify as any).expectedChunks
      output.actualChunks = (verify as any).actualChunks
      output.chunkMismatch = (verify as any).chunkMismatch
      output.isStale = isIndexStale(verify)
      if (verbose) {
        output.changedFiles = (verify as any).changedFiles ?? []
        output.missingFiles = (verify as any).missingFiles ?? []
        output.removedFiles = (verify as any).removedFiles ?? []
      }
    }
    writeJson(output)
    return
  }

  if (command === "verify") {
    const result = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.verifyIndex(),
    })
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    const strict = flags.strict === true
    const isStrictHealthy = !isIndexStale(result)
    const payload = {
      ...result,
      isStale: isIndexStale(result),
      strict,
      ok: strict ? isStrictHealthy : true,
      stats,
    }
    if (flags.json) {
      writeJson(payload)
    } else {
      writeStdoutLine(`Verify: ${formatVerifySummary(result)}${strict ? ` strict=${isStrictHealthy}` : ""}`)
      writeStdoutLine(
        `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}${(result as any).chunkMismatch === true ? ` expectedChunks=${(result as any).expectedChunks} actualChunks=${(result as any).actualChunks}` : ""}`,
      )
    }
    if (strict && !isStrictHealthy) process.exitCode = 1
    return
  }

  if (command === "languages") {
    await runLanguagesCommand(flags, rootDir)
    return
  }

  if (command === "semantic-kinds") {
    await runSemanticKindsCommand(flags)
    return
  }

  if (command === "selftest") {
    await runSelftestCommand(flags, rootDir, {
      SenseGrepTool,
      SenseGrepSurveyTool,
      SenseGrepClusterTool,
      Indexer,
      Instance,
      DuplicateDetector,
    })
    return
  }

  if (command === "search") {
    const query = getSearchQuery(flags, positional)
    if (!query) {
      writeStderrLine("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params = buildCommonSearchParams(query, flags, { rerank: false, shake: true })
    if (flags.exact !== undefined) params.exact = true
    assignNumberParam(params, flags, "maxPerFile", ["max-per-file", "maxPerFile"])
    assignNumberParam(params, flags, "maxPerSymbol", ["max-per-symbol", "maxPerSymbol"])
    if (flags.rerank !== undefined) {
      const rerankFlag = toBool(flags.rerank)
      if (rerankFlag !== undefined) params.rerank = rerankFlag
    }
    if (flags["no-rerank"] !== undefined) params.rerank = false

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    await executeSearchLikeTool({ flags, rootDir, Instance, toolFactory: SenseGrepTool, params })
    return
  }

  if (command === "survey") {
    const query = getSearchQuery(flags, positional)
    if (!query) {
      writeStderrLine("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params = buildCommonSearchParams(query, flags, { shake: true })
    assignNumberParam(params, flags, "rawLimit", ["raw-limit", "rawLimit"])
    assignNumberParam(params, flags, "perGroup", ["per-group", "perGroup"])

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    await executeSearchLikeTool({ flags, rootDir, Instance, toolFactory: SenseGrepSurveyTool, params })
    return
  }

  if (command === "cluster") {
    const query = getSearchQuery(flags, positional)
    if (!query) {
      writeStderrLine("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params = buildCommonSearchParams(query, flags, { shake: true })
    assignNumberParam(params, flags, "rawLimit", ["raw-limit", "rawLimit"])
    assignNumberParam(params, flags, "perCluster", ["per-cluster", "perCluster"])
    assignNumberParam(params, flags, "clusterThreshold", ["cluster-threshold", "clusterThreshold"])
    assignNumberParam(params, flags, "minClusterSize", ["min-cluster-size", "minClusterSize"])

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    await executeSearchLikeTool({ flags, rootDir, Instance, toolFactory: SenseGrepClusterTool, params })
    return
  }

  if (command === "detect-duplicates") {
    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)

    // Parse threshold
    const minThreshold = parseRequiredNumberFlag(flags, "threshold", { min: 0, max: 1 }) ?? 0.85

    // Parse scope filter
    let scopeFilter: Array<"function" | "method"> | undefined
    if (flags.scope) {
      const scopeStr = String(flags.scope).toLowerCase()
      if (scopeStr === "all") {
        scopeFilter = [] // no filter (all)
      } else {
        const tokens = scopeStr.split(",").map((s) => s.trim()).filter(Boolean)
        const invalid = tokens.filter((token) => token !== "function" && token !== "method")
        if (tokens.length === 0 || invalid.length > 0) {
          throw new CliUsageError("--scope must contain only function, method, or all")
        }
        scopeFilter = tokens as Array<"function" | "method">
      }
    } else {
      // Default: function + method
      scopeFilter = ["function", "method"]
    }

    let normalizeIdentifiers = toBool(flags["normalize-identifiers"])
    if (flags["no-normalize-identifiers"] !== undefined) normalizeIdentifiers = false
    if (normalizeIdentifiers === undefined) normalizeIdentifiers = true

    let rankByImpact = toBool(flags["rank-by-impact"])
    if (flags["no-rank-by-impact"] !== undefined) rankByImpact = false
    if (rankByImpact === undefined) rankByImpact = true

    const options: DuplicateDetectOptions = {
      path: rootDir,
      thresholds: {
        exact: 0.98,
        high: 0.90,
        medium: 0.85,
        low: minThreshold, // use parsed threshold as minimum
      },
      scopeFilter,
      ignoreTests: toBool(flags["ignore-tests"]) ?? false,
      crossFileOnly: toBool(flags["cross-file-only"]) ?? false,
      crossLanguage: toBool(flags["cross-language"]) ?? false,
      language: flags.language ? String(flags.language) : undefined,
      onlyExported: toBool(flags["only-exported"]) ?? false,
      excludePattern: flags["exclude-pattern"] ? String(flags["exclude-pattern"]) : undefined,
      minLines: parsePositiveIntegerFlag(flags, "min-lines") ?? 10,
      minComplexity: parseRequiredNumberFlag(flags, "min-complexity", { min: 0 }) ?? 0,
      maxCandidates: parsePositiveIntegerFlag(flags, "max-candidates"),
      include: flags.include ? String(flags.include) : undefined,
      exclude: flags.exclude ? String(flags.exclude) : undefined,
      ignoreAcceptablePatterns: toBool(flags["ignore-acceptable-patterns"]) ?? false,
      normalizeIdentifiers,
      rankByImpact,
    }

    const showCode = toBool(flags["show-code"]) ?? false
    const fullCode = toBool(flags["full-code"]) ?? false
    const verbose = toBool(flags.verbose) ?? false
    const quiet = toBool(flags.quiet) ?? false
    const limit = parsePositiveIntegerFlag(flags, "limit") ?? 10
    const thresholds: Required<NonNullable<DuplicateDetectOptions["thresholds"]>> = {
      exact: 0.98,
      high: 0.9,
      medium: 0.85,
      low: minThreshold,
      ...(options.thresholds ?? {}),
    }

    const suppressHumanLog = flags["log-format"] === "none"
    const humanLog = suppressHumanLog ? undefined : createHumanLogger({ json: flags.json === true })

    if (!quiet && humanLog) {
      humanLog("Detecting logical duplicates...")
      humanLog(`Path: ${rootDir}`)
      humanLog(`Threshold: ${minThreshold}`)
      humanLog(`Scope: ${scopeFilter?.join(", ") || "all"}`)
      if (options.crossFileOnly) humanLog("Filter: cross-file only")
      if (options.onlyExported) humanLog("Filter: exported only")
      if (options.include) humanLog(`Filter: include ${options.include}`)
      if (options.exclude) humanLog(`Filter: exclude ${options.exclude}`)
      if (options.excludePattern) humanLog(`Filter: exclude pattern /${options.excludePattern}/`)
      humanLog("")
    }

    const result = await DuplicateDetector.detect(options)

    if (flags.json) {
      writeJson(result)
      return
    }

    // Helper: Get category emoji and label
    function getCategoryInfo(level: string, similarity: number) {
      if (similarity >= thresholds.exact || level === "exact") {
        return { emoji: "🔥", label: "CRITICAL", color: "critical" }
      }
      if (level === "high") return { emoji: "⚠️ ", label: "HIGH", color: "high" }
      if (level === "medium") return { emoji: "ℹ️ ", label: "MEDIUM", color: "medium" }
      return { emoji: "💡", label: "LOW", color: "low" }
    }

    const formatPct = (value: number) => (value * 100).toFixed(1)

    // Summary
    if (!quiet) {
      writeStdoutLine("━".repeat(80))
      writeStdoutLine("DUPLICATE DETECTION RESULTS")
      writeStdoutLine("━".repeat(80))
      writeStdoutLine(`Total duplicates: ${result.summary.totalDuplicates}`)

      const critical = result.duplicates.filter(d => d.similarity >= thresholds.exact).length
      const high = result.duplicates.filter(
        d => d.similarity >= thresholds.high && d.similarity < thresholds.exact,
      ).length
      const medium = result.duplicates.filter(
        d => d.similarity >= thresholds.medium && d.similarity < thresholds.high,
      ).length
      const low = result.duplicates.filter(
        d => d.similarity >= thresholds.low && d.similarity < thresholds.medium,
      ).length

      if (critical > 0) {
        writeStdoutLine(
          `  🔥 Critical (≥${formatPct(thresholds.exact)}%): ${critical}  ← Exact duplicates, refactor NOW`,
        )
      }
      if (high > 0) {
        writeStdoutLine(
          `  ⚠️  High (${formatPct(thresholds.high)}–${formatPct(thresholds.exact)}%): ${high}   ← Very similar, should review`,
        )
      }
      if (medium > 0) {
        writeStdoutLine(
          `  ℹ️  Medium (${formatPct(thresholds.medium)}–${formatPct(thresholds.high)}%): ${medium} ← Similar, investigate`,
        )
      }
      if (low > 0) {
        writeStdoutLine(
          `  💡 Low (${formatPct(thresholds.low)}–${formatPct(thresholds.medium)}%): ${low}   ← Somewhat similar`,
        )
      }

      writeStdoutLine()
      writeStdoutLine(`Files affected: ${result.summary.filesAffected}`)
      writeStdoutLine(`Potential savings: ${result.summary.totalSavings} lines`)
      writeStdoutLine()
    }

    if (result.duplicates.length === 0) {
      writeStdoutLine("✅ No significant duplicates found!")
      return
    }

    if (quiet) return // quiet mode: only summary

    // Show top duplicates
    const topDuplicates = result.duplicates.slice(0, limit)
    writeStdoutLine(`Top ${topDuplicates.length} duplicates (ranked by impact):`)
    writeStdoutLine()

    for (let i = 0; i < topDuplicates.length; i++) {
      const dup = topDuplicates[i]
      const { emoji, label } = getCategoryInfo(dup.level, dup.similarity)

      writeStdoutLine(`${emoji} #${i + 1} - ${label} (${(dup.similarity * 100).toFixed(1)}% similar)`)

      if (verbose) {
        writeStdoutLine(`   Impact: ${dup.impact.totalLines} lines × ${dup.impact.complexity.toFixed(1)} complexity × ${dup.impact.fileCount} files = ${dup.impact.score.toFixed(0)} score`)
        writeStdoutLine(`   Potential savings: ${dup.impact.estimatedSavings} lines`)
      }

      for (const inst of dup.instances) {
        const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "")
        const lines = inst.endLine - inst.startLine + 1
        writeStdoutLine(`   ${relPath}:${inst.startLine}-${inst.endLine} (${inst.symbol}, ${lines} lines)`)
      }

      // Show code if requested
      if (showCode || verbose || fullCode) {
        writeStdoutLine()
        for (let j = 0; j < dup.instances.length; j++) {
          const inst = dup.instances[j]
          const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "")

          writeStdoutLine(`   ┌─ ${String.fromCharCode(65 + j)}: ${relPath}:${inst.startLine}`)

          // Truncate code to max 15 lines for readability
          const codeLines = inst.content.split("\n")
          const maxLines = fullCode ? codeLines.length : showCode && !verbose ? 15 : 30
          const displayLines = codeLines.slice(0, maxLines)

          for (const line of displayLines) {
            writeStdoutLine(`   │ ${line}`)
          }

          if (codeLines.length > maxLines) {
            writeStdoutLine(`   │ ... (${codeLines.length - maxLines} more lines)`)
          }
          writeStdoutLine(`   └─`)
        }
      }

      writeStdoutLine()
    }

    if (result.duplicates.length > limit) {
      writeStdoutLine(`... and ${result.duplicates.length - limit} more duplicates`)
      writeStdoutLine(`Use --limit ${result.duplicates.length} to see all`)
      writeStdoutLine()
    }

    if (result.acceptableDuplicates && result.acceptableDuplicates.length > 0) {
      writeStdoutLine(`💡 ${result.acceptableDuplicates.length} acceptable duplicates ignored (simple validations, guards, etc.)`)
    }

    return
  }

  writeStderrLine(`Unknown command: ${command}`)
  usage()
  process.exitCode = 1
}

async function runLanguagesCommand(flags: Flags, rootDir: string) {
  const {
    getLanguageCapabilities,
    getVariantsGroupedByLanguage,
    detectProjectLanguages,
    formatDetectedLanguages,
    getAllLanguages,
  } = await loadCore()

  if (flags.detect) {
    const detected = await detectProjectLanguages(rootDir)

    if (flags.json) {
      writeJson({ languages: detected })
      return
    }

    writeStdoutLine("Detecting languages in project...\n")

    if (detected.length === 0) {
      writeStdoutLine("No supported languages detected.")
    } else {
      writeStdoutLine(formatDetectedLanguages(detected))
    }
    return
  }

  if (flags.variants) {
    const variantsByLang = getVariantsGroupedByLanguage()
    if (flags.json) {
      writeJson({
        variants: Object.fromEntries([...variantsByLang.entries()]),
      })
      return
    }

    writeStdoutLine("Variants by language:\n")
    for (const [lang, variants] of variantsByLang) {
      writeStdoutLine(`  ${lang}:`)
      for (const v of variants) {
        writeStdoutLine(`    - ${v.name.padEnd(15)} ${v.description}`)
      }
      writeStdoutLine()
    }
    return
  }

  // Default: list languages
  const all = getAllLanguages()
  const caps = getLanguageCapabilities()

  if (flags.json) {
    writeJson({ languages: all, capabilities: caps })
    return
  }

  writeStdoutLine("Supported languages:\n")
  for (const lang of all) {
    writeStdoutLine(`  ✅ ${lang.displayName} (${lang.extensions.join(", ")})`)
  }
  writeStdoutLine(`\nSymbol types: ${caps.symbolTypes.join(", ")}`)
  writeStdoutLine(`Variants: ${caps.variants.length} total`)
  writeStdoutLine(`Decorators: ${caps.decorators.length} total`)
  writeStdoutLine(`\nUse 'sensegrep languages --variants' to see all variants`)
  writeStdoutLine("Use 'sensegrep languages --detect' to detect project languages")
}

async function runSelftestCommand(
  flags: Flags,
  rootDir: string,
  core: Pick<
    CoreModule,
    "SenseGrepTool" | "SenseGrepSurveyTool" | "SenseGrepClusterTool" | "Indexer" | "Instance" | "DuplicateDetector"
  >,
) {
  type Check = {
    name: string
    ok: boolean
    skipped?: boolean
    message?: string
    details?: unknown
  }

  const checks: Check[] = []
  const strict = flags.strict === true
  const deep = flags.deep === true

  async function check(name: string, fn: () => Promise<Partial<Omit<Check, "name">> | void>) {
    try {
      const result = await fn()
      checks.push({ name, ok: true, ...(result ?? {}) })
    } catch (error) {
      checks.push({
        name,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await check("cli.version", async () => ({
    message: getCliVersion(),
  }))

  await check("semantic-kinds", async () => {
    const { getAvailableSemanticKinds } = await loadCore()
    const semanticKinds = getAvailableSemanticKinds()
    if (semanticKinds.length === 0) throw new Error("No semantic kinds registered")
    return { message: `${semanticKinds.length} semantic kinds`, details: semanticKinds.map((kind) => kind.name) }
  })

  await check("embeddings.config", async () => {
    const { Embeddings } = await loadCore()
    const config = Embeddings.getConfig()
    const credentialGuidance = config.provider === "ollama"
      ? "No API key required; start Ollama and pull the configured embedding model before indexing."
      : config.provider === "gemini"
        ? "Set GEMINI_API_KEY or GOOGLE_API_KEY before indexing."
        : config.provider === "openai"
          ? "Set SENSEGREP_OPENAI_API_KEY, FIREWORKS_API_KEY, OPENAI_API_KEY, or configure apiKey in ~/.config/sensegrep/config.json before indexing."
          : "Set AWS credentials/AWS_REGION for Bedrock, or configure apiKey/region in ~/.config/sensegrep/config.json before indexing."
    const credentialState = config.provider === "ollama"
      ? "credentials=not-required"
      : config.apiKey ? "credentials=present" : `credentials=missing (${credentialGuidance})`
    const endpoint = (config.provider === "openai" || config.provider === "ollama") && config.baseUrl ? ` baseUrl=${config.baseUrl}` : ""
    const region = config.provider === "bedrock" && config.region ? ` region=${config.region}` : ""
    return {
      message: `provider=${config.provider} model=${config.embedModel} dim=${config.embedDim}${endpoint}${region} ${credentialState}`,
      details: {
        provider: config.provider,
        embedModel: config.embedModel,
        embedDim: config.embedDim,
        baseUrl: config.provider === "openai" || config.provider === "ollama" ? config.baseUrl : undefined,
        region: config.provider === "bedrock" ? config.region : undefined,
        credentialsPresent: Boolean(config.apiKey),
        credentialGuidance: config.apiKey ? undefined : credentialGuidance,
      },
    }
  })

  await check("languages.detect", async () => {
    const { detectProjectLanguages } = await loadCore()
    const detected = await detectProjectLanguages(rootDir)
    return {
      message: detected.length > 0 ? detected.map((d: any) => `${d.language}:${d.fileCount}`).join(", ") : "no supported languages detected",
      details: detected,
    }
  })

  let verifyResult: Awaited<ReturnType<CoreModule["Indexer"]["verifyIndex"]>> | undefined
  await check("index.verify", async () => {
    verifyResult = await core.Instance.provide({
      directory: rootDir,
      fn: () => core.Indexer.verifyIndex(),
    })
    const healthy = !isIndexStale(verifyResult)
    if (strict && !healthy) throw new Error(`Strict index invariant failed: ${formatVerifySummary(verifyResult)}`)
    return {
      ok: healthy || !strict,
      message: formatVerifySummary(verifyResult),
      details: verifyResult,
    }
  })

  await check("status.stats", async () => {
    const stats = await core.Instance.provide({
      directory: rootDir,
      fn: () => core.Indexer.getStats(),
    })
    if (strict && !stats.indexed) throw new Error("Index is not present")
    return {
      ok: stats.indexed || !strict,
      message: `indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks}`,
      details: stats,
    }
  })

  if (deep) {
    await check("search.json-shape", async () => {
      if (!verifyResult || isIndexStale(verifyResult)) {
        return { ok: true, skipped: true, message: "skipped because index is missing or stale" }
      }
      const tool = await core.SenseGrepTool.init()
      const res = await core.Instance.provide({
        directory: rootDir,
        fn: () =>
          tool.execute(
            { query: "code search", limit: 1, rerank: false, shake: true },
            {
              sessionID: "cli-selftest",
              messageID: "cli-selftest",
              agent: "sensegrep-cli",
              abort: new AbortController().signal,
              metadata(_input: { title?: string; metadata?: unknown }) {},
            },
          ),
      })
      if (!Array.isArray((res as any).results)) throw new Error("search result is missing results[]")
      return { message: `results=${(res as any).results.length}` }
    })

    await check("duplicates.json-shape", async () => {
      const res = await core.DuplicateDetector.detect({
        path: rootDir,
        maxCandidates: 50,
        thresholds: { exact: 0.98, high: 0.9, medium: 0.85, low: 0.85 },
      })
      if (!(res as any).summary || !Array.isArray((res as any).duplicates)) {
        throw new Error("duplicate detector result is missing summary/duplicates")
      }
      return { message: `duplicates=${(res as any).summary.totalDuplicates}` }
    })
  } else {
    checks.push({
      name: "deep-search",
      ok: true,
      skipped: true,
      message: "use --deep to test remote-embedding search and duplicate JSON shape",
    })
  }

  const failed = checks.filter((item) => !item.ok)
  const payload = {
    ok: failed.length === 0,
    strict,
    deep,
    root: rootDir,
    checks,
  }

  if (flags.json) {
    writeJson(payload)
  } else {
    for (const item of checks) {
      const status = item.skipped ? "SKIP" : item.ok ? "OK" : "FAIL"
      writeStdoutLine(`${status.padEnd(4)} ${item.name}${item.message ? ` - ${item.message}` : ""}`)
    }
  }

  if (failed.length > 0) process.exitCode = 1
}

async function runSemanticKindsCommand(flags: Flags) {
  const { getAvailableSemanticKinds } = await loadCore()
  const semanticKinds = getAvailableSemanticKinds()

  if (flags.json) {
    writeJson({ semanticKinds })
    return
  }

  writeStdoutLine("Framework-aware semantic kinds:\n")
  for (const kind of semanticKinds) {
    const framework = kind.framework ? ` (${kind.framework})` : ""
    const aliases = Array.isArray((kind as any).aliases) && (kind as any).aliases.length > 0
      ? ` aliases: ${(kind as any).aliases.join(", ")}`
      : ""
    writeStdoutLine(`  - ${kind.name}${framework}: ${kind.description}${aliases}`)
  }
  writeStdoutLine("\nUse with: sensegrep search \"...\" --semantic-kind <kind>")
  writeStdoutLine("Wildcards are supported, for example: --semantic-kind convex*")
}

run().catch((error) => {
  if (error instanceof CliUsageError) {
    writeStderrLine(error.message)
  } else {
    writeStderrLine(error instanceof Error ? error.stack ?? error.message : String(error))
  }
  process.exitCode = 1
})
