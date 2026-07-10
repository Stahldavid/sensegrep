import type { Flags } from "./search-commands.js"
import { CliUsageError } from "./cli-errors.js"
import { writeJson, writeStdoutLine } from "./output.js"

type CoreModule = typeof import("@sensegrep/core")

function positiveInteger(flags: Flags, name: string): number | undefined {
  if (flags[name] === undefined) return undefined
  const value = Number(flags[name])
  if (!Number.isInteger(value) || value <= 0) throw new CliUsageError(`--${name} must be a positive integer`)
  return value
}

export async function runAnalysisCommand(input: {
  command: string
  flags: Flags
  positional: string[]
  rootDir: string
  core: Pick<CoreModule, "EmbeddingBenchmark" | "CodeGraph" | "Instance" | "VectorStore">
}): Promise<boolean> {
  const { command, flags, positional, rootDir, core } = input
  if (command === "benchmark") {
    const candidates = typeof flags.concurrency === "string" ? flags.concurrency.split(",").map(Number) : undefined
    const result = await core.EmbeddingBenchmark.run({
      concurrencyCandidates: candidates,
      sampleCount: positiveInteger(flags, "samples"),
      repeats: positiveInteger(flags, "repeats"),
    })
    if (flags.json) writeJson(result)
    else {
      writeStdoutLine(`Embedding benchmark: ${result.provider}/${result.model} (${result.dimension} dimensions)`)
      for (const trial of result.trials) {
        writeStdoutLine(`  concurrency=${trial.concurrency} ${trial.durationMs.toFixed(0)}ms ${trial.inputsPerSecond.toFixed(2)} inputs/s ${trial.tokensPerSecond.toFixed(0)} tokens/s`)
      }
      writeStdoutLine(`Recommended: ${Object.entries(result.recommendedEnvironment).map(([key, value]) => `${key}=${value}`).join(" ")}`)
    }
    return true
  }

  if (command === "references" || command === "impact" || command === "trace") {
    let [first, second] = positional
    const id = typeof flags.id === "string" ? flags.id : undefined
    const fromId = typeof flags["from-id"] === "string" ? flags["from-id"] : undefined
    const toId = typeof flags["to-id"] === "string" ? flags["to-id"] : undefined
    if (!first && id) first = id.split(":").at(-1) ?? ""
    if (!first && fromId) first = fromId.split(":").at(-1) ?? ""
    if (!second && toId) second = toId.split(":").at(-1) ?? ""
    if (!first || (command === "trace" && !second)) {
      throw new CliUsageError(command === "trace" ? "trace requires <from> <to>" : `${command} requires <symbol>`)
    }
    const depth = positiveInteger(flags, "depth")
    const limit = positiveInteger(flags, "max-nodes") ?? positiveInteger(flags, "limit")
    const maxDocuments = positiveInteger(flags, "max-documents")
    const result = command === "references"
      ? await core.Instance.provide({ directory: rootDir, fn: () => core.CodeGraph.findReferences(first!, { id, limit, maxDocuments }) })
      : command === "impact"
        ? await core.Instance.provide({ directory: rootDir, fn: () => core.CodeGraph.impact(first!, { id, depth, limit, maxDocuments }) })
        : await core.Instance.provide({ directory: rootDir, fn: () => core.CodeGraph.trace(first!, second!, { fromId, toId, depth, maxDocuments }) })
    if (flags.json) writeJson(result)
    else writeStdoutLine(JSON.stringify(result, null, 2))
    return true
  }

  if (command === "profiles") {
    const profiles = await core.VectorStore.listProfiles(rootDir)
    const active = process.env.SENSEGREP_PROFILE ?? "default"
    if (flags.json) writeJson({ active, profiles })
    else {
      writeStdoutLine(`Active profile: ${active}`)
      for (const entry of profiles) {
        writeStdoutLine(`  ${entry.profile} ${entry.embeddings.provider}/${entry.embeddings.model ?? "default"} dim=${entry.embeddings.dimension} updated=${new Date(entry.updatedAt).toISOString()}`)
      }
    }
    return true
  }

  return false
}
