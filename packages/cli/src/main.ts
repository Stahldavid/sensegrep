#!/usr/bin/env node
import type { Tool as ToolType, DuplicateDetector as DuplicateDetectorType } from "@sensegrep/core"
import { readFileSync } from "node:fs"

type Flags = Record<string, string | boolean>

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
  console.log(`
sensegrep (CLI)

Usage:
  sensegrep index [--root <dir>] [--full|--incremental] [--verify|--check] [--no-watch] [--include-docs] [--include-config]
  sensegrep verify [--root <dir>]
  sensegrep status [--root <dir>]
  sensegrep search <query...> [options]
  sensegrep survey <query...> [options]
  sensegrep cluster <query...> [options]
  sensegrep detect-duplicates [--root <dir>] [options]
  sensegrep languages [--detect] [--variants]
  sensegrep semantic-kinds [--json]

Search options:
  --query <text>            Query text (if not provided as positional)
  --pattern <regex>         Regex filter (post-filter)
  --limit <n>               Max results (default: 20)
  --include <glob>          File glob include filter (e.g. "src/**/*.ts")
  --exclude <glob>          File glob exclude filter (e.g. "*.md" or "docs/**")
  --type <symbolType>       function|class|method|type|variable|enum|module
  --variant <name>          Language-specific variant (interface, dataclass, protocol, etc.)
  --decorator <name>        Filter by decorator (@property, @dataclass, etc.)
  --symbol <name>           Filter by symbol name
  --name <name>             Alias for --symbol
  --exported <true|false>   Only exported symbols
  --async                   Only async functions/methods
  --static                  Only static methods
  --abstract                Only abstract classes/methods
  --min-complexity <n>      Minimum cyclomatic complexity
  --max-complexity <n>      Maximum cyclomatic complexity
  --min-score <n>           Minimum relevance score 0-1
  --max-per-file <n>        Max results per file (default: 2)
  --max-per-symbol <n>      Max results per symbol (default: 2)
  --has-docs <true|false>   Require documentation
  --language <lang>         typescript|javascript|python|java|vue (comma-separated for multiple)
  --parent <name>           Parent scope/class name
  --imports <name>          Filter by imported module name
  --rerank <true|false>     Compatibility flag; semantic ranking is kept as-is
  --no-rerank               Disable reranking
  --embed-model <name>      Override remote embedding model
  --embed-dim <n>           Override embedding dimension
  --provider <name>         gemini|openai|bedrock
  --semantic-kind <kind>    Framework-aware kind (convexMutation, reactComponent, routeHandler, etc.)
  --explain-filters         Include deterministic filter match explanations
  --strict-parent           Mark parent filter as strict indexed-metadata validation
  --strict-imports          Mark import filter as strict AST-metadata validation
  --ensure-fresh <mode>     check|incremental|full before search/survey/cluster/duplicates
  --root <dir>              Root directory (default: cwd)
  --watch                   Keep running; reindex on changes (default: on)
  --no-watch                Exit after indexing (for CI/scripts)
  --include-docs            Include markdown/docs in the index (default: false)
  --include-config          Include config files (JSON/YAML/TOML) in the index (default: false)
  --json                    Output JSON

Survey options:
  --raw-limit <n>           Raw matches to gather before grouping (default: 60)
  --per-group <n>           Representative snippets per group (default: 2)

Cluster options:
  --raw-limit <n>           Raw matches to gather before clustering (default: 70)
  --per-cluster <n>         Representative snippets per cluster (default: 2)
  --cluster-threshold <n>   Similarity threshold for linking clusters (default: 0.72)
  --min-cluster-size <n>    Minimum cluster size before singleton fallback (default: 2)

Duplicate detection options:
  --threshold <number>      Minimum similarity 0.0-1.0 (default: 0.85)
  --scope <type>            function, method, or all (default: function,method)
  --language <lang>         Filter by language (comma-separated)
  --cross-language          Detect duplicates across languages (default: off)
  --ignore-tests            Ignore test files
  --cross-file-only         Only report cross-file duplicates
  --only-exported           Only check exported functions
  --exclude-pattern <regex> Exclude functions matching pattern
  --min-lines <n>           Minimum lines (default: 10)
  --min-complexity <n>      Minimum complexity (default: 0)
  --max-candidates <n>      Max duplicate candidates to analyze (default: 1500)
  --ignore-acceptable-patterns  Do not ignore simple validations/guards
  --normalize-identifiers <true|false>  Normalize identifiers (default: true)
  --no-normalize-identifiers    Disable identifier normalization
  --rank-by-impact <true|false> Rank by impact score (default: true)
  --no-rank-by-impact           Disable ranking by impact
  --limit <n>               Show top N results (default: 10)
  --full-code               Show full code snippets (no truncation)
  --show-code               Display actual duplicate code
  --verbose                 Show full details
  --quiet                   Only show summary
  --json                    Output JSON

Language management:
  sensegrep languages                 List supported languages
  sensegrep languages --detect        Detect project languages
  sensegrep languages --variants      Show all variants by language
  sensegrep semantic-kinds            List framework-aware semanticKind filters

Index health:
  sensegrep status --verbose          Include changed/missing/removed file lists
  sensegrep index --check             Exit non-zero if index is stale
  sensegrep index --check --max-changed 5 --max-missing 0
`)
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

function toBool(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value
  if (!value) return undefined
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase())
}

function applyEmbeddingOverrides(flags: Flags, Embeddings: CoreModule["Embeddings"]) {
  const overrides: Record<string, unknown> = {}
  const provider = flags.provider ? String(flags.provider).toLowerCase() : undefined

  if (flags.device || flags["rerank-model"] || flags.rerankModel) {
    throw new Error("Device and reranker overrides were removed. Use remote Gemini, OpenAI-compatible, or Bedrock embeddings only.")
  }
  if (provider && provider !== "gemini" && provider !== "openai" && provider !== "bedrock") {
    throw new Error(`Unsupported provider "${provider}". Use --provider gemini, --provider openai, or --provider bedrock.`)
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
    fn: () => (mode === "full" ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
  })
  console.error(`Refreshed stale index before query: ${formatIndexResult(result)}`)
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
    console.log(getCliVersion())
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
    const watch = noWatch ? false : (toBool(flags.watch) ?? true)
    const includeDocs = flags["include-docs"] === true
    const includeConfig = flags["include-config"] === true

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
        console.log(JSON.stringify(payload, null, 2))
      } else {
        console.log(`Index check: ${formatVerifySummary(verify)} stale=${stale}`)
      }
      process.exitCode = stale ? 1 : 0
      return
    }

    // Auto-detect languages if not specified
    const { detectProjectLanguages } = await loadCore()
    const detected = await detectProjectLanguages(rootDir)
    if (detected.length > 0) {
      const langSummary = detected.map((d: any) => `${d.language} (${d.fileCount})`).join(", ")
      console.log(`Detected: ${langSummary}`)
    }

    let skipIndex = false
    if (flags.verify === true) {
      const check = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      })
      console.log(`Verify: ${formatVerifySummary(check)}`)
      if (
        check.indexed &&
        check.changed === 0 &&
        check.missing === 0 &&
        check.removed === 0 &&
        (check as any).chunkMismatch !== true &&
        !full
      ) {
        console.log("Index is up to date. Skipping.")
        skipIndex = true
      }
    }
    if (!skipIndex) {
      const result = await Instance.provide({
        directory: rootDir,
        fn: () =>
          full ? Indexer.indexProject() : Indexer.indexProjectIncremental(),
      })
      console.log(formatIndexResult(result))
    }
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    console.log(
      `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}`,
    )
    if (watch) {
      console.log("Watching for changes (reindex at most once per minute)... Use --no-watch to disable.")
      const handle = await IndexWatcher.start({
        rootDir,
        entrypoint: "cli",
        intervalMs: 60_000,
        onIndex: (result) => {
          console.log(formatIndexResult(result))
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
    const [stats, verify] = await Promise.all([
      Instance.provide({
        directory: rootDir,
        fn: () => Indexer.getStats(),
      }),
      Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      }),
    ])
    const output: Record<string, unknown> = {
      ...stats,
      changed: (verify as any).changed,
      missing: (verify as any).missing,
      removed: (verify as any).removed,
      expectedChunks: (verify as any).expectedChunks,
      actualChunks: (verify as any).actualChunks,
      chunkMismatch: (verify as any).chunkMismatch,
      isStale: isIndexStale(verify),
    }
    if (verbose) {
      output.changedFiles = (verify as any).changedFiles ?? []
      output.missingFiles = (verify as any).missingFiles ?? []
      output.removedFiles = (verify as any).removedFiles ?? []
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

if (command === "verify") {
    const result = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.verifyIndex(),
    })
    console.log(JSON.stringify(result, null, 2))
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    console.log(
      `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}${(result as any).chunkMismatch === true ? ` expectedChunks=${(result as any).expectedChunks} actualChunks=${(result as any).actualChunks}` : ""}`,
    )
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

  if (command === "search") {
    const query = (flags.query as string | undefined) || positional.join(" ")
    if (!query) {
      console.error("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params: ToolType.InferParameters<typeof SenseGrepTool> = {
      query,
      rerank: false,
      shake: true,
    }

if (flags.pattern) params.pattern = String(flags.pattern)
    if (flags.limit) params.limit = Number(flags.limit)
    if (flags.include) params.include = String(flags.include)
    if (flags.exclude) params.exclude = String(flags.exclude)
    if (flags.type) params.symbolType = String(flags.type) as any
    if (flags.symbolType) params.symbolType = String(flags.symbolType) as any
    if (flags.variant) params.variant = String(flags.variant)
    if (flags.decorator) params.decorator = String(flags.decorator)
    if (flags.async !== undefined) params.isAsync = true
    if (flags.static !== undefined) params.isStatic = true
    if (flags.abstract !== undefined) params.isAbstract = true
    if (flags.exported !== undefined) params.isExported = toBool(flags.exported)
    if (flags.minComplexity) params.minComplexity = Number(flags.minComplexity)
    if (flags["min-complexity"]) params.minComplexity = Number(flags["min-complexity"])
    if (flags.maxComplexity) params.maxComplexity = Number(flags.maxComplexity)
    if (flags["max-complexity"]) params.maxComplexity = Number(flags["max-complexity"])
    if (flags.hasDocs !== undefined) params.hasDocumentation = toBool(flags.hasDocs)
    if (flags["has-docs"] !== undefined) params.hasDocumentation = toBool(flags["has-docs"])
    if (flags.language) params.language = String(flags.language) as any
    if (flags.parent) params.parentScope = String(flags.parent)
    if (flags.parentScope) params.parentScope = String(flags.parentScope)
    if (flags.imports) params.imports = String(flags.imports)
    if (flags["semantic-kind"]) (params as any).semanticKind = String(flags["semantic-kind"])
    if (flags.semanticKind) (params as any).semanticKind = String(flags.semanticKind)
    if (flags["explain-filters"] !== undefined) (params as any).explainFilters = true
    if (flags.explainFilters !== undefined) (params as any).explainFilters = true
    if (flags["strict-parent"] !== undefined) (params as any).strictParent = true
    if (flags.strictParent !== undefined) (params as any).strictParent = true
    if (flags["strict-imports"] !== undefined) (params as any).strictImports = true
    if (flags.strictImports !== undefined) (params as any).strictImports = true
    if (flags.symbol) params.symbol = String(flags.symbol)
    if (flags.name) params.symbol = String(flags.name)
    if (flags["min-score"]) params.minScore = Number(flags["min-score"])
    if (flags.minScore) params.minScore = Number(flags.minScore)
    if (flags["max-per-file"]) params.maxPerFile = Number(flags["max-per-file"])
    if (flags.maxPerFile) params.maxPerFile = Number(flags.maxPerFile)
    if (flags["max-per-symbol"]) params.maxPerSymbol = Number(flags["max-per-symbol"])
    if (flags.maxPerSymbol) params.maxPerSymbol = Number(flags.maxPerSymbol)
    if (flags.rerank !== undefined) {
      const rerankFlag = toBool(flags.rerank)
      if (rerankFlag !== undefined) params.rerank = rerankFlag
    }
    if (flags["no-rerank"] !== undefined) params.rerank = false

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    const tool = await SenseGrepTool.init()
    const res = await Instance.provide({
      directory: rootDir,
      fn: () =>
        tool.execute(params, {
          sessionID: "cli",
          messageID: "cli",
          agent: "sensegrep-cli",
          abort: new AbortController().signal,
          metadata(_input: { title?: string; metadata?: unknown }) {},
        }),
    })

    if (flags.json) {
      console.log(JSON.stringify(res, null, 2))
      return
    }
    console.log(res.output)
    return
  }

  if (command === "survey") {
    const query = (flags.query as string | undefined) || positional.join(" ")
    if (!query) {
      console.error("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params: ToolType.InferParameters<typeof SenseGrepSurveyTool> = {
      query,
      shake: true,
    }

    if (flags.pattern) params.pattern = String(flags.pattern)
    if (flags.limit) params.limit = Number(flags.limit)
    if (flags["raw-limit"]) params.rawLimit = Number(flags["raw-limit"])
    if (flags.rawLimit) params.rawLimit = Number(flags.rawLimit)
    if (flags["per-group"]) params.perGroup = Number(flags["per-group"])
    if (flags.perGroup) params.perGroup = Number(flags.perGroup)
    if (flags.include) params.include = String(flags.include)
    if (flags.exclude) params.exclude = String(flags.exclude)
    if (flags.type) params.symbolType = String(flags.type) as any
    if (flags.symbolType) params.symbolType = String(flags.symbolType) as any
    if (flags.variant) params.variant = String(flags.variant)
    if (flags.decorator) params.decorator = String(flags.decorator)
    if (flags.async !== undefined) params.isAsync = true
    if (flags.static !== undefined) params.isStatic = true
    if (flags.abstract !== undefined) params.isAbstract = true
    if (flags.exported !== undefined) params.isExported = toBool(flags.exported)
    if (flags.minComplexity) params.minComplexity = Number(flags.minComplexity)
    if (flags["min-complexity"]) params.minComplexity = Number(flags["min-complexity"])
    if (flags.maxComplexity) params.maxComplexity = Number(flags.maxComplexity)
    if (flags["max-complexity"]) params.maxComplexity = Number(flags["max-complexity"])
    if (flags.hasDocs !== undefined) params.hasDocumentation = toBool(flags.hasDocs)
    if (flags["has-docs"] !== undefined) params.hasDocumentation = toBool(flags["has-docs"])
    if (flags.language) params.language = String(flags.language) as any
    if (flags.parent) params.parentScope = String(flags.parent)
    if (flags.parentScope) params.parentScope = String(flags.parentScope)
    if (flags.imports) params.imports = String(flags.imports)
    if (flags["semantic-kind"]) (params as any).semanticKind = String(flags["semantic-kind"])
    if (flags.semanticKind) (params as any).semanticKind = String(flags.semanticKind)
    if (flags["explain-filters"] !== undefined) (params as any).explainFilters = true
    if (flags.explainFilters !== undefined) (params as any).explainFilters = true
    if (flags["strict-parent"] !== undefined) (params as any).strictParent = true
    if (flags.strictParent !== undefined) (params as any).strictParent = true
    if (flags["strict-imports"] !== undefined) (params as any).strictImports = true
    if (flags.strictImports !== undefined) (params as any).strictImports = true
    if (flags.symbol) params.symbol = String(flags.symbol)
    if (flags.name) params.symbol = String(flags.name)
    if (flags["min-score"]) params.minScore = Number(flags["min-score"])
    if (flags.minScore) params.minScore = Number(flags.minScore)

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    const tool = await SenseGrepSurveyTool.init()
    const res = await Instance.provide({
      directory: rootDir,
      fn: () =>
        tool.execute(params, {
          sessionID: "cli",
          messageID: "cli",
          agent: "sensegrep-cli",
          abort: new AbortController().signal,
          metadata(_input: { title?: string; metadata?: unknown }) {},
        }),
    })

    if (flags.json) {
      console.log(JSON.stringify(res, null, 2))
      return
    }
    console.log(res.output)
    return
  }

  if (command === "cluster") {
    const query = (flags.query as string | undefined) || positional.join(" ")
    if (!query) {
      console.error("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params: ToolType.InferParameters<typeof SenseGrepClusterTool> = {
      query,
      shake: true,
    }

    if (flags.pattern) params.pattern = String(flags.pattern)
    if (flags.limit) params.limit = Number(flags.limit)
    if (flags["raw-limit"]) params.rawLimit = Number(flags["raw-limit"])
    if (flags.rawLimit) params.rawLimit = Number(flags.rawLimit)
    if (flags["per-cluster"]) params.perCluster = Number(flags["per-cluster"])
    if (flags.perCluster) params.perCluster = Number(flags.perCluster)
    if (flags["cluster-threshold"]) params.clusterThreshold = Number(flags["cluster-threshold"])
    if (flags.clusterThreshold) params.clusterThreshold = Number(flags.clusterThreshold)
    if (flags["min-cluster-size"]) params.minClusterSize = Number(flags["min-cluster-size"])
    if (flags.minClusterSize) params.minClusterSize = Number(flags.minClusterSize)
    if (flags.include) params.include = String(flags.include)
    if (flags.exclude) params.exclude = String(flags.exclude)
    if (flags.type) params.symbolType = String(flags.type) as any
    if (flags.symbolType) params.symbolType = String(flags.symbolType) as any
    if (flags.variant) params.variant = String(flags.variant)
    if (flags.decorator) params.decorator = String(flags.decorator)
    if (flags.async !== undefined) params.isAsync = true
    if (flags.static !== undefined) params.isStatic = true
    if (flags.abstract !== undefined) params.isAbstract = true
    if (flags.exported !== undefined) params.isExported = toBool(flags.exported)
    if (flags.minComplexity) params.minComplexity = Number(flags.minComplexity)
    if (flags["min-complexity"]) params.minComplexity = Number(flags["min-complexity"])
    if (flags.maxComplexity) params.maxComplexity = Number(flags.maxComplexity)
    if (flags["max-complexity"]) params.maxComplexity = Number(flags["max-complexity"])
    if (flags.hasDocs !== undefined) params.hasDocumentation = toBool(flags.hasDocs)
    if (flags["has-docs"] !== undefined) params.hasDocumentation = toBool(flags["has-docs"])
    if (flags.language) params.language = String(flags.language) as any
    if (flags.parent) params.parentScope = String(flags.parent)
    if (flags.parentScope) params.parentScope = String(flags.parentScope)
    if (flags.imports) params.imports = String(flags.imports)
    if (flags["semantic-kind"]) (params as any).semanticKind = String(flags["semantic-kind"])
    if (flags.semanticKind) (params as any).semanticKind = String(flags.semanticKind)
    if (flags["explain-filters"] !== undefined) (params as any).explainFilters = true
    if (flags.explainFilters !== undefined) (params as any).explainFilters = true
    if (flags["strict-parent"] !== undefined) (params as any).strictParent = true
    if (flags.strictParent !== undefined) (params as any).strictParent = true
    if (flags["strict-imports"] !== undefined) (params as any).strictImports = true
    if (flags.strictImports !== undefined) (params as any).strictImports = true
    if (flags.symbol) params.symbol = String(flags.symbol)
    if (flags.name) params.symbol = String(flags.name)
    if (flags["min-score"]) params.minScore = Number(flags["min-score"])
    if (flags.minScore) params.minScore = Number(flags.minScore)

    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)
    const tool = await SenseGrepClusterTool.init()
    const res = await Instance.provide({
      directory: rootDir,
      fn: () =>
        tool.execute(params, {
          sessionID: "cli",
          messageID: "cli",
          agent: "sensegrep-cli",
          abort: new AbortController().signal,
          metadata(_input: { title?: string; metadata?: unknown }) {},
        }),
    })

    if (flags.json) {
      console.log(JSON.stringify(res, null, 2))
      return
    }
    console.log(res.output)
    return
  }

  if (command === "detect-duplicates") {
    await ensureFreshIfRequested(flags, rootDir, Instance, Indexer)

    // Parse threshold
    const minThreshold = flags.threshold ? Number(flags.threshold) : 0.85

    // Parse scope filter
    let scopeFilter: Array<"function" | "method"> | undefined
    if (flags.scope) {
      const scopeStr = String(flags.scope).toLowerCase()
      if (scopeStr === "all") {
        scopeFilter = [] // no filter (all)
      } else if (scopeStr === "function") {
        scopeFilter = ["function"]
      } else if (scopeStr === "method") {
        scopeFilter = ["method"]
      } else {
        // comma-separated
        scopeFilter = scopeStr.split(",").map((s) => s.trim()) as any
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
      minLines: flags["min-lines"] ? Number(flags["min-lines"]) : 10,
      minComplexity: flags["min-complexity"] ? Number(flags["min-complexity"]) : 0,
      maxCandidates: flags["max-candidates"] ? Number(flags["max-candidates"]) : undefined,
      ignoreAcceptablePatterns: toBool(flags["ignore-acceptable-patterns"]) ?? false,
      normalizeIdentifiers,
      rankByImpact,
    }

    const showCode = toBool(flags["show-code"]) ?? false
    const fullCode = toBool(flags["full-code"]) ?? false
    const verbose = toBool(flags.verbose) ?? false
    const quiet = toBool(flags.quiet) ?? false
    const limit = flags.limit ? Number(flags.limit) : 10
    const thresholds: Required<NonNullable<DuplicateDetectOptions["thresholds"]>> = {
      exact: 0.98,
      high: 0.9,
      medium: 0.85,
      low: minThreshold,
      ...(options.thresholds ?? {}),
    }

    const humanLog = flags.json ? console.error : console.log

    if (!quiet) {
      humanLog("Detecting logical duplicates...")
      humanLog(`Path: ${rootDir}`)
      humanLog(`Threshold: ${minThreshold}`)
      humanLog(`Scope: ${scopeFilter?.join(", ") || "all"}`)
      if (options.crossFileOnly) humanLog("Filter: cross-file only")
      if (options.onlyExported) humanLog("Filter: exported only")
      if (options.excludePattern) humanLog(`Filter: exclude pattern /${options.excludePattern}/`)
      humanLog("")
    }

    const result = await DuplicateDetector.detect(options)

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2))
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
      console.log("━".repeat(80))
      console.log("DUPLICATE DETECTION RESULTS")
      console.log("━".repeat(80))
      console.log(`Total duplicates: ${result.summary.totalDuplicates}`)

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
        console.log(
          `  🔥 Critical (≥${formatPct(thresholds.exact)}%): ${critical}  ← Exact duplicates, refactor NOW`,
        )
      }
      if (high > 0) {
        console.log(
          `  ⚠️  High (${formatPct(thresholds.high)}–${formatPct(thresholds.exact)}%): ${high}   ← Very similar, should review`,
        )
      }
      if (medium > 0) {
        console.log(
          `  ℹ️  Medium (${formatPct(thresholds.medium)}–${formatPct(thresholds.high)}%): ${medium} ← Similar, investigate`,
        )
      }
      if (low > 0) {
        console.log(
          `  💡 Low (${formatPct(thresholds.low)}–${formatPct(thresholds.medium)}%): ${low}   ← Somewhat similar`,
        )
      }

      console.log("")
      console.log(`Files affected: ${result.summary.filesAffected}`)
      console.log(`Potential savings: ${result.summary.totalSavings} lines`)
      console.log("")
    }

    if (result.duplicates.length === 0) {
      console.log("✅ No significant duplicates found!")
      return
    }

    if (quiet) return // quiet mode: only summary

    // Show top duplicates
    const topDuplicates = result.duplicates.slice(0, limit)
    console.log(`Top ${topDuplicates.length} duplicates (ranked by impact):`)
    console.log("")

    for (let i = 0; i < topDuplicates.length; i++) {
      const dup = topDuplicates[i]
      const { emoji, label } = getCategoryInfo(dup.level, dup.similarity)

      console.log(`${emoji} #${i + 1} - ${label} (${(dup.similarity * 100).toFixed(1)}% similar)`)

      if (verbose) {
        console.log(`   Impact: ${dup.impact.totalLines} lines × ${dup.impact.complexity.toFixed(1)} complexity × ${dup.impact.fileCount} files = ${dup.impact.score.toFixed(0)} score`)
        console.log(`   Potential savings: ${dup.impact.estimatedSavings} lines`)
      }

      for (const inst of dup.instances) {
        const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "")
        const lines = inst.endLine - inst.startLine + 1
        console.log(`   ${relPath}:${inst.startLine}-${inst.endLine} (${inst.symbol}, ${lines} lines)`)
      }

      // Show code if requested
      if (showCode || verbose || fullCode) {
        console.log("")
        for (let j = 0; j < dup.instances.length; j++) {
          const inst = dup.instances[j]
          const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "")

          console.log(`   ┌─ ${String.fromCharCode(65 + j)}: ${relPath}:${inst.startLine}`)

          // Truncate code to max 15 lines for readability
          const codeLines = inst.content.split("\n")
          const maxLines = fullCode ? codeLines.length : showCode && !verbose ? 15 : 30
          const displayLines = codeLines.slice(0, maxLines)

          for (const line of displayLines) {
            console.log(`   │ ${line}`)
          }

          if (codeLines.length > maxLines) {
            console.log(`   │ ... (${codeLines.length - maxLines} more lines)`)
          }
          console.log(`   └─`)
        }
      }

      console.log("")
    }

    if (result.duplicates.length > limit) {
      console.log(`... and ${result.duplicates.length - limit} more duplicates`)
      console.log(`Use --limit ${result.duplicates.length} to see all`)
      console.log("")
    }

    if (result.acceptableDuplicates && result.acceptableDuplicates.length > 0) {
      console.log(`💡 ${result.acceptableDuplicates.length} acceptable duplicates ignored (simple validations, guards, etc.)`)
    }

    return
  }

console.error(`Unknown command: ${command}`)
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
    console.log("Detecting languages in project...\n")
    const detected = await detectProjectLanguages(rootDir)

    if (detected.length === 0) {
      console.log("No supported languages detected.")
    } else {
      console.log(formatDetectedLanguages(detected))
    }
    return
  }

  if (flags.variants) {
    const variantsByLang = getVariantsGroupedByLanguage()
    console.log("Variants by language:\n")
    for (const [lang, variants] of variantsByLang) {
      console.log(`  ${lang}:`)
      for (const v of variants) {
        console.log(`    - ${v.name.padEnd(15)} ${v.description}`)
      }
      console.log()
    }
    return
  }

  // Default: list languages
  const all = getAllLanguages()
  const caps = getLanguageCapabilities()

  console.log("Supported languages:\n")
  for (const lang of all) {
    console.log(`  ✅ ${lang.displayName} (${lang.extensions.join(", ")})`)
  }
  console.log(`\nSymbol types: ${caps.symbolTypes.join(", ")}`)
  console.log(`Variants: ${caps.variants.length} total`)
  console.log(`Decorators: ${caps.decorators.length} total`)
  console.log(`\nUse 'sensegrep languages --variants' to see all variants`)
  console.log("Use 'sensegrep languages --detect' to detect project languages")
}

async function runSemanticKindsCommand(flags: Flags) {
  const { getAvailableSemanticKinds } = await loadCore()
  const semanticKinds = getAvailableSemanticKinds()

  if (flags.json) {
    console.log(JSON.stringify({ semanticKinds }, null, 2))
    return
  }

  console.log("Framework-aware semantic kinds:\n")
  for (const kind of semanticKinds) {
    const framework = kind.framework ? ` (${kind.framework})` : ""
    console.log(`  - ${kind.name}${framework}: ${kind.description}`)
  }
  console.log("\nUse with: sensegrep search \"...\" --semantic-kind <kind>")
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
