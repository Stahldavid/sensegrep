#!/usr/bin/env node
import type { Tool as ToolType, DuplicateDetector as DuplicateDetectorType } from "@sensegrep/core"

type Flags = Record<string, string | boolean>

type CoreModule = typeof import("@sensegrep/core")

let corePromise: Promise<CoreModule> | null = null

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
  sensegrep index [--root <dir>] [--full|--incremental] [--verify] [--watch] [--languages <list>]
  sensegrep verify [--root <dir>]
  sensegrep status [--root <dir>]
  sensegrep search <query...> [options]
  sensegrep detect-duplicates [--root <dir>] [options]
  sensegrep languages [--detect] [--variants]

Search options:
  --query <text>            Query text (if not provided as positional)
  --pattern <regex>         Regex filter (post-filter)
  --limit <n>               Max results (default: 20)
  --include <glob>          File glob filter (e.g. "src/**/*.ts")
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
  --max-per-file <n>        Max results per file (default: 1)
  --max-per-symbol <n>      Max results per symbol (default: 1)
  --has-docs <true|false>   Require documentation
  --language <lang>         typescript|javascript|python|html (comma-separated for multiple)
  --parent <name>           Parent scope/class name
  --imports <name>          Filter by imported module name
  --rerank <true|false>     Enable cross-encoder reranking (default: false)
  --no-rerank               Disable reranking
  --embed-model <name>      Override embedding model (Hugging Face)
  --embed-dim <n>           Override embedding dimension
  --rerank-model <name>     Override reranker model
  --device <name>           cpu|cuda|webgpu|wasm
  --provider <name>         local|gemini
  --root <dir>              Root directory (default: cwd)
  --watch                   Keep running; reindex at most once per minute on changes
  --json                    Output JSON

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
  if (flags["embed-model"]) overrides.embedModel = String(flags["embed-model"])
  if (flags.embedModel) overrides.embedModel = String(flags.embedModel)
  if (flags["embed-dim"]) overrides.embedDim = Number(flags["embed-dim"])
  if (flags.embedDim) overrides.embedDim = Number(flags.embedDim)
  if (flags["rerank-model"]) overrides.rerankModel = String(flags["rerank-model"])
  if (flags.rerankModel) overrides.rerankModel = String(flags.rerankModel)
  if (flags.device) overrides.device = String(flags.device)
  if (flags.provider) overrides.provider = String(flags.provider)

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

async function run() {
  const {
    SenseGrepTool,
    Indexer,
    IndexWatcher,
    Instance,
    Embeddings,
    DuplicateDetector,
    Log,
  } = await loadCore()

  const argv = process.argv.slice(2)
  const command = argv[0]
  const { flags, positional } = parseArgs(argv.slice(1))

  if (!command || flags.help) {
    usage()
    return
  }

  // Configure log level: WARN by default, INFO if --verbose
  const logLevel = toBool(flags.verbose) ? "INFO" : "WARN"
  await Log.init({ print: true, level: logLevel as any })

  const rootDir = (flags.root as string | undefined) || process.cwd()
  applyEmbeddingOverrides(flags, Embeddings)

  if (command === "index") {
    const full = flags.full === true
    const watch = toBool(flags.watch) === true
    
    // Auto-detect languages if not specified
    const { detectProjectLanguages, formatDetectedLanguages } = await loadCore()
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
      console.log(
        `Verify: indexed=${check.indexed} changed=${check.changed} missing=${check.missing} removed=${check.removed}`,
      )
      if (
        check.indexed &&
        check.changed === 0 &&
        check.missing === 0 &&
        check.removed === 0 &&
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
      console.log("Watching for changes (reindex at most once per minute)...")
      const handle = await IndexWatcher.start({
        rootDir,
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
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    console.log(JSON.stringify(stats, null, 2))
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
      `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}`,
    )
    return
  }

  if (command === "languages") {
    await runLanguagesCommand(flags, rootDir)
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

  if (command === "detect-duplicates") {
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
      onlyExported: toBool(flags["only-exported"]) ?? false,
      excludePattern: flags["exclude-pattern"] ? String(flags["exclude-pattern"]) : undefined,
      minLines: flags["min-lines"] ? Number(flags["min-lines"]) : 10,
      minComplexity: flags["min-complexity"] ? Number(flags["min-complexity"]) : 0,
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

    if (!quiet) {
      console.log("Detecting logical duplicates...")
      console.log(`Path: ${rootDir}`)
      console.log(`Threshold: ${minThreshold}`)
      console.log(`Scope: ${scopeFilter?.join(", ") || "all"}`)
      if (options.crossFileOnly) console.log("Filter: cross-file only")
      if (options.onlyExported) console.log("Filter: exported only")
      if (options.excludePattern) console.log(`Filter: exclude pattern /${options.excludePattern}/`)
      console.log("")
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

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
