#!/usr/bin/env node
import { SenseGrepTool, Indexer, Instance, Tool } from "@sensegrep/core"

type Flags = Record<string, string | boolean>

function usage() {
  console.log(`
sensegrep (CLI)

Usage:
  sensegrep index [--root <dir>] [--full|--incremental] [--verify]
  sensegrep verify [--root <dir>]
  sensegrep status [--root <dir>]
  sensegrep search <query...> [options]

Search options:
  --query <text>            Query text (if not provided as positional)
  --pattern <regex>         Regex filter (post-filter)
  --limit <n>               Max results (default: 20)
  --include <glob>          File glob filter (e.g. "src/**/*.ts")
  --type <symbolType>       function|class|method|interface|type|variable|namespace|enum
  --exported <true|false>   Only exported symbols
  --min-complexity <n>      Minimum cyclomatic complexity
  --max-complexity <n>      Maximum cyclomatic complexity
  --has-docs <true|false>   Require documentation
  --language <lang>         typescript|javascript|tsx|jsx
  --parent <name>           Parent scope/class name
  --rerank <true|false>     Enable cross-encoder reranking (default: false)
  --no-rerank               Disable reranking
  --root <dir>              Root directory (default: cwd)
  --json                    Output JSON
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

type IndexResult =
  | Awaited<ReturnType<typeof Indexer.indexProject>>
  | Awaited<ReturnType<typeof Indexer.indexProjectIncremental>>

function isIncremental(
  result: IndexResult,
): result is Awaited<ReturnType<typeof Indexer.indexProjectIncremental>> {
  return (result as any).mode === "incremental"
}

async function run() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const { flags, positional } = parseArgs(argv.slice(1))

  if (!command || flags.help) {
    usage()
    return
  }

  const rootDir = (flags.root as string | undefined) || process.cwd()

  if (command === "index") {
    const full = flags.full === true
    if (flags.verify === true) {
      const check = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.verifyIndex(),
      })
      console.log(
        `Verify: indexed=${check.indexed} changed=${check.changed} missing=${check.missing} removed=${check.removed}`,
      )
      if (check.indexed && check.changed === 0 && check.missing === 0 && check.removed === 0 && !full) {
        console.log("Index is up to date. Skipping.")
        return
      }
    }
    const result = await Instance.provide({
      directory: rootDir,
      fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
    })
    if (isIncremental(result)) {
      console.log(
        `Indexed ${result.files} files (${result.chunks} chunks), skipped ${result.skipped}, removed ${result.removed} in ${(
          result.duration / 1000
        ).toFixed(1)}s`,
      )
    } else {
      console.log(`Indexed ${result.files} files (${result.chunks} chunks) in ${(result.duration / 1000).toFixed(1)}s`)
    }
    const stats = await Instance.provide({
      directory: rootDir,
      fn: () => Indexer.getStats(),
    })
    console.log(
      `Index summary: indexed=${stats.indexed} files=${stats.files} chunks=${stats.chunks} provider=${stats.embeddings?.provider ?? "n/a"}`,
    )
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

  if (command === "search") {
    const query = (flags.query as string | undefined) || positional.join(" ")
    if (!query) {
      console.error("Missing query")
      usage()
      process.exitCode = 1
      return
    }

    const params: Tool.InferParameters<typeof SenseGrepTool> = {
      query,
      rerank: false,
    }

    if (flags.pattern) params.pattern = String(flags.pattern)
    if (flags.limit) params.limit = Number(flags.limit)
    if (flags.include) params.include = String(flags.include)
    if (flags.type) params.symbolType = String(flags.type) as any
    if (flags.symbolType) params.symbolType = String(flags.symbolType) as any
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

  console.error(`Unknown command: ${command}`)
  usage()
  process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
