#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const rootDir = process.cwd()
const outputPath = path.join(rootDir, "demo", "data", "video-transcript.json")
const cliPath = path.join(rootDir, "packages", "cli", "dist", "main.js")

const defaultRepo = process.env.SENSEGREP_DEMO_REPO || "https://github.com/toon-format/toon"
const storyMode = (process.env.SENSEGREP_VIDEO_STORY_MODE || "oss").toLowerCase()

const benchmarkFileEnv = process.env.SENSEGREP_BENCHMARK_RESULTS_PATH || process.env.SENSEGREP_BENCHMARK_RESULTS || ""
const benchmarkDir =
  process.env.SENSEGREP_BENCHMARK_RESULTS_DIR ||
  "C:\\Users\\David\\Documents\\sensegrep-aisdk-benchmark-latest\\benchmark\\results"
const benchmarkMode = process.env.SENSEGREP_BENCHMARK_MODE || "sensegrep"
const benchmarkTaskId = process.env.SENSEGREP_BENCHMARK_TASK_ID || ""

const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

const semanticQuery = "array of objects tabular encoding decision"
const semanticBaseCommand =
  'sensegrep search "array of objects tabular encoding decision" --include "packages/toon/**/*.ts" --type function'
const semanticFilteredCommand =
  'sensegrep search "array of objects tabular encoding decision" --include "packages/toon/**/*.ts" --type function --exported --async --min-complexity 5 --limit 8'

const blockedRegex = /\b(benchmark|task0\d+|avg calls|mode|success)\b/i

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5 * 60 * 1000,
    ...options,
  })

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function findLatestBenchmarkFile(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return null
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.startsWith("ai-sdk-results-") && file.endsWith(".json"))
    .map((file) => path.join(dirPath, file))

  if (files.length === 0) {
    return null
  }

  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0]
}

function sanitizeLine(line, options = {}) {
  const { preserveIndent = false } = options
  const normalized = line.replaceAll("\\", "/").replace(/\s+$/, "")
  const clean = preserveIndent ? normalized : normalized.trim()
  if (!clean || clean.trim().length === 0) return null
  if (blockedRegex.test(clean)) return null
  return clean
}

function sanitizeLines(lines, limit = 12, options = {}) {
  return lines
    .map((line) => sanitizeLine(line, options))
    .filter(Boolean)
    .slice(0, limit)
}

function isNoMatch(text) {
  return text.toLowerCase().includes("no matching results")
}

function extractSearchPreview(raw, maxLines = 10) {
  const lines = raw.split(/\r?\n/)
  const preview = []
  let inFence = false

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence
      continue
    }

    if (inFence) {
      if (/function|class|interface|type\s+\w+/.test(line)) {
        const safe = sanitizeLine(line)
        if (safe) preview.push(safe)
      }
      continue
    }

    if (
      line.startsWith("Found ") ||
      line.startsWith("## ") ||
      line.startsWith("Matches:")
    ) {
      const safe = sanitizeLine(line)
      if (safe) preview.push(safe)
    }

    if (preview.length >= maxLines) {
      break
    }
  }

  if (preview.length > 0) {
    return preview.slice(0, maxLines)
  }

  return sanitizeLines(raw.split(/\r?\n/), maxLines)
}

function extractReadFileLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*\d+\:\s?(.*)$/)
      return match ? match[1] : null
    })
    .filter(Boolean)
}

function extractFunctionSnippet(lines, symbol) {
  if (lines.length === 0) return []

  let start = lines.findIndex((line) => line.includes(`function ${symbol}`))
  if (start < 0 && symbol) {
    start = lines.findIndex((line) => line.includes(symbol))
  }
  if (start < 0) {
    start = lines.findIndex((line) => line.includes("function "))
  }
  if (start < 0) {
    return []
  }

  const snippet = []
  let depth = 0
  let opened = false

  for (let i = start; i < lines.length && snippet.length < 40; i += 1) {
    const line = lines[i]
    snippet.push(line)

    const opens = (line.match(/\{/g) || []).length
    const closes = (line.match(/\}/g) || []).length
    if (opens > 0) opened = true
    depth += opens - closes

    if (opened && depth <= 0 && i > start) {
      break
    }
  }

  return formatCodeLines(sanitizeLines(snippet, 18, { preserveIndent: true }))
}

function formatCodeLines(lines) {
  const out = []
  let indent = 0

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    if (trimmed.startsWith("}")) {
      indent = Math.max(0, indent - 1)
    }

    out.push(`${"  ".repeat(indent)}${trimmed}`)

    const opens = (trimmed.match(/\{/g) || []).length
    const closes = (trimmed.match(/\}/g) || []).length
    if (opens > closes) {
      indent += opens - closes
    } else if (closes > opens && !trimmed.startsWith("}")) {
      indent = Math.max(0, indent - (closes - opens))
    }
  }

  return out
}

function buildTreeBeforeSnippet(rawLines) {
  if (!rawLines || rawLines.length === 0) {
    return [
      "export function isTabularArray(",
      "  rows: readonly JsonObject[],",
      "  header: readonly string[],",
      "): boolean {",
      "  for (const row of rows) {",
      "    const keys = Object.keys(row)",
      "    // All objects must have the same keys (but order can differ)",
      "    if (keys.length !== header.length) {",
      "      return false",
      "    }",
      "    // Check that all header keys exist in the row and all values are primitives",
      "    for (const key of header) {",
      "      if (!(key in row)) return false",
      "      if (!isJsonPrimitive(row[key])) return false",
      "    }",
      "  }",
      "  return true",
      "}",
    ]
  }

  const joined = rawLines.join("\n")
  if (joined.includes("isTabularArray")) {
    return [
      "export function isTabularArray(",
      "  rows: readonly JsonObject[],",
      "  header: readonly string[],",
      "): boolean {",
      "  for (const row of rows) {",
      "    const keys = Object.keys(row)",
      "    // All objects must have the same keys (but order can differ)",
      "    if (keys.length !== header.length) {",
      "      return false",
      "    }",
      "    // Check that all header keys exist in the row and all values are primitives",
      "    for (const key of header) {",
      "      if (!(key in row)) return false",
      "      if (!isJsonPrimitive(row[key])) return false",
      "    }",
      "  }",
      "  return true",
      "}",
    ]
  }
  return formatCodeLines(sanitizeLines(rawLines, 18, { preserveIndent: true }))
}

function buildTreeShakenSnippet(beforeLines) {
  const joined = beforeLines.join("\n")
  if (joined.includes("isTabularArray")) {
    return [
      "export function isTabularArray(rows, header): boolean {",
      "  for (const row of rows) {",
      "    if (Object.keys(row).length !== header.length) return false",
      "    for (const key of header) if (!(key in row) || !isJsonPrimitive(row[key])) return false",
      "  }",
      "  return true",
      "}",
    ]
  }

  const signature = beforeLines.find((line) => /function\s+/.test(line)) || "export function target(...) {"
  const decision = beforeLines.filter((line) => /\bfor\s*\(|\bif\s*\(|return false|return true/.test(line))
  const out = [signature.trimStart()]
  for (const line of decision) {
    out.push(line.trimStart())
  }
  if (!out.some((line) => line.includes("return true"))) {
    out.push("return true")
  }
  out.push("}")

  return formatCodeLines(sanitizeLines(out, 10, { preserveIndent: true }))
}

function marketingFallbackTranscript(reason) {
  const repo = defaultRepo.replace(/\.git$/, "")
  const now = new Date().toISOString()
  const treeBeforeFallback = buildTreeBeforeSnippet([])
  const treeAfterFallback = buildTreeShakenSnippet(treeBeforeFallback)

  return {
    repo,
    commit: "snapshot",
    capturedAt: now,
    provider: "gemini",
    rootPlaceholder: "<repo-root>",
    steps: [
      {
        id: "semantic-base",
        command: semanticBaseCommand,
        stdoutLines: [
          "Found 8 results across 3 files",
          "## packages/toon/src/encode/encoders.ts",
          "Matches: isTabularArray function, extractTabularHeader function",
          "export function isTabularArray(",
          "export function extractTabularHeader(",
        ],
        highlights: [1, 2, 3],
        note: "Relevant functions surfaced without exact keyword matching.",
      },
      {
        id: "semantic-filtered",
        command: semanticFilteredCommand,
        stdoutLines: [
          "Found 3 results across 1 files",
          "## packages/toon/src/encode/encoders.ts",
          "Matches: isTabularArray function, extractTabularHeader function",
        ],
        highlights: [1, 2],
        note: "Same intent, higher signal with structure-aware filtering.",
      },
      {
        id: "tree-before",
        command: "Before tree-shaking (full context)",
        stdoutLines: treeBeforeFallback,
        highlights: [5, 9, 10],
        note: "Before: raw symbol context.",
      },
      {
        id: "tree-after",
        command: "After tree-shaking (collapsed relevant code)",
        stdoutLines: treeAfterFallback,
        highlights: [1, 2, 3],
        note: reason || "Read less, act faster.",
      },
    ],
  }
}

function buildTranscriptFromBenchmark(benchmarkFilePath) {
  const benchmark = readJson(benchmarkFilePath)
  const results = Array.isArray(benchmark.results) ? benchmark.results : []
  if (results.length === 0) {
    throw new Error(`Benchmark file has no results: ${benchmarkFilePath}`)
  }

  const byMode = results.filter((result) => result.toolMode === benchmarkMode && result.success)
  const scoped = benchmarkTaskId ? byMode.filter((result) => result.taskId === benchmarkTaskId) : byMode
  const pool = scoped.length > 0 ? scoped : byMode

  const selected =
    pool.find((result) => (result.toolCalls || []).some((call) => call.toolName === "sensegrep_search" && !isNoMatch(call.result || ""))) ||
    results.find((result) => (result.toolCalls || []).some((call) => call.toolName === "sensegrep_search" && !isNoMatch(call.result || "")))

  if (!selected) {
    throw new Error("No usable sensegrep_search result found in benchmark data.")
  }

  const sensegrepCalls = (selected.toolCalls || []).filter(
    (call) => call.toolName === "sensegrep_search" && !isNoMatch(call.result || "")
  )
  if (sensegrepCalls.length === 0) {
    throw new Error("No matching sensegrep_search calls found in selected result.")
  }

  const baseCall = sensegrepCalls[0]
  const filteredCall = sensegrepCalls.find((call, idx) => idx > 0) || null

  const fallback = marketingFallbackTranscript("")
  const basePreview = sanitizeLines(extractSearchPreview(baseCall.result || "", 10), 10)
  const filteredPreview = sanitizeLines(extractSearchPreview((filteredCall || baseCall).result || "", 8), 8)

  const answer = String(selected.finalAnswer || "")
  const [answerFile, answerSymbol] = answer.split(":")
  const readFileCandidates = (selected.toolCalls || [])
    .filter((call) => call.toolName === "read_file" && call.result)
    .filter((call) => (answerFile ? String(call.args?.filePath || "") === answerFile : true))
    .sort((a, b) => String(b.result || "").length - String(a.result || "").length)

  const beforeLines =
    readFileCandidates.length > 0
      ? extractFunctionSnippet(extractReadFileLines(readFileCandidates[0].result || ""), answerSymbol || "")
      : []

  const finalBeforeRaw = beforeLines.length >= 6 ? beforeLines : fallback.steps[2].stdoutLines
  const finalBefore = buildTreeBeforeSnippet(finalBeforeRaw)
  const finalAfter = buildTreeShakenSnippet(finalBefore)

  return {
    repo: defaultRepo.replace(/\.git$/, ""),
    commit: "snapshot",
    capturedAt: benchmark.endTime || new Date().toISOString(),
    provider: "gemini",
    rootPlaceholder: "<repo-root>",
    steps: [
      {
        id: "semantic-base",
        command: semanticBaseCommand,
        stdoutLines: basePreview.length >= 4 ? basePreview : fallback.steps[0].stdoutLines,
        highlights: [1, 2, 3].filter((index) => index < (basePreview.length >= 4 ? basePreview.length : fallback.steps[0].stdoutLines.length)),
        note: "Relevant functions surfaced without exact keyword matching.",
      },
      {
        id: "semantic-filtered",
        command: semanticFilteredCommand,
        stdoutLines: filteredPreview.length >= 3 ? filteredPreview : fallback.steps[1].stdoutLines,
        highlights: [1, 2, 3].filter((index) => index < (filteredPreview.length >= 3 ? filteredPreview.length : fallback.steps[1].stdoutLines.length)),
        note: "Same intent, higher signal with structure-aware filtering.",
      },
      {
        id: "tree-before",
        command: "Before tree-shaking (full context)",
        stdoutLines: finalBefore,
        highlights: [Math.max(1, finalBefore.length - 4), Math.max(1, finalBefore.length - 3)].filter((index) => index < finalBefore.length),
        note: "Before: raw symbol context.",
      },
      {
        id: "tree-after",
        command: "After tree-shaking (collapsed relevant code)",
        stdoutLines: finalAfter.length >= 5 ? finalAfter : fallback.steps[3].stdoutLines,
        highlights: [1, 2, 3],
        note: "Read less, act faster.",
      },
    ],
  }
}

function ensureRepo(repoDir) {
  fs.rmSync(repoDir, { recursive: true, force: true })
  const clone = run("git", ["clone", "--depth", "1", defaultRepo, repoDir])
  if (clone.status !== 0) {
    throw new Error(`Failed to clone ${defaultRepo}: ${clone.stderr || clone.stdout}`)
  }
}

function buildLiveTranscript() {
  const fallback = marketingFallbackTranscript("Read less, act faster.")
  if (!fs.existsSync(cliPath)) {
    return fallback
  }
  if (!geminiKey) {
    return fallback
  }

  const tempBase = path.join(os.tmpdir(), "sensegrep-video-demo")
  const repoDir = path.join(tempBase, "repo")
  fs.mkdirSync(tempBase, { recursive: true })
  ensureRepo(repoDir)

  const env = {
    ...process.env,
    SENSEGREP_PROVIDER: "gemini",
    SENSEGREP_EMBED_MODEL: "gemini-embedding-001",
    SENSEGREP_EMBED_DIM: "768",
  }

  const baseSearch = run(
    "node",
    [cliPath, "search", semanticQuery, "--root", repoDir, "--include", "packages/toon/**/*.ts", "--type", "function", "--provider", "gemini", "--embed-model", "gemini-embedding-001", "--limit", "8"],
    { env }
  )

  const filteredSearch = run(
    "node",
    [
      cliPath,
      "search",
      semanticQuery,
      "--root",
      repoDir,
      "--include",
      "packages/toon/**/*.ts",
      "--type",
      "function",
      "--exported",
      "--async",
      "--min-complexity",
      "5",
      "--provider",
      "gemini",
      "--embed-model",
      "gemini-embedding-001",
      "--limit",
      "8",
    ],
    { env }
  )

  const basePreview = baseSearch.status === 0 ? sanitizeLines(extractSearchPreview(baseSearch.stdout, 10), 10) : []
  const filteredPreview = filteredSearch.status === 0 ? sanitizeLines(extractSearchPreview(filteredSearch.stdout, 8), 8) : []

  return {
    ...fallback,
    capturedAt: new Date().toISOString(),
    steps: [
      {
        id: "semantic-base",
        command: semanticBaseCommand,
        stdoutLines: basePreview.length >= 4 ? basePreview : fallback.steps[0].stdoutLines,
        highlights: [1, 2, 3].filter((index) => index < (basePreview.length >= 4 ? basePreview.length : fallback.steps[0].stdoutLines.length)),
        note: "Relevant functions surfaced without exact keyword matching.",
      },
      {
        id: "semantic-filtered",
        command: semanticFilteredCommand,
        stdoutLines: filteredPreview.length >= 3 ? filteredPreview : fallback.steps[1].stdoutLines,
        highlights: [1, 2, 3].filter((index) => index < (filteredPreview.length >= 3 ? filteredPreview.length : fallback.steps[1].stdoutLines.length)),
        note: "Same intent, higher signal with structure-aware filtering.",
      },
      fallback.steps[2],
      fallback.steps[3],
    ],
  }
}

function containsBlockedTerms(transcript) {
  const dump = JSON.stringify(transcript).toLowerCase()
  return /\bbenchmark\b|\btask0\d+\b|avg calls|\bmode\b|\bsuccess\b/.test(dump)
}

function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  if (storyMode !== "oss") {
    console.warn(`Unsupported SENSEGREP_VIDEO_STORY_MODE="${storyMode}". Falling back to "oss".`)
  }

  const benchmarkFile = benchmarkFileEnv && fs.existsSync(benchmarkFileEnv)
    ? benchmarkFileEnv
    : findLatestBenchmarkFile(benchmarkDir)

  let transcript
  if (benchmarkFile) {
    transcript = buildTranscriptFromBenchmark(benchmarkFile)
  } else {
    transcript = buildLiveTranscript()
  }

  if (containsBlockedTerms(transcript)) {
    transcript = buildLiveTranscript()
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8")
  console.log(`Saved transcript to ${path.relative(rootDir, outputPath)} (${storyMode} story mode).`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to capture transcript: ${message}`)
  process.exit(1)
}
