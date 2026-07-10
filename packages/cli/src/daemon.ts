import { createServer, request as httpRequest } from "node:http"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import path from "node:path"
import type { Flags } from "./search-commands.js"
import { writeJson, writeStdoutLine } from "./output.js"

type Core = typeof import("@sensegrep/core")
const toolCache = new Map<string, Promise<any>>()

function daemonPort(root: string): number {
  const hash = Number.parseInt(crypto.createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 6), 16)
  return 40_000 + (hash % 20_000)
}

async function invokeTool(core: Core, root: string, profile: string | undefined, toolName: string, args: Record<string, unknown>) {
  const factories: Record<string, any> = {
    search: core.SenseGrepTool,
    context: core.SenseGrepContextTool,
    literal: core.SenseGrepLiteralTool,
    survey: core.SenseGrepSurveyTool,
    cluster: core.SenseGrepClusterTool,
    show: core.SenseGrepShowTool,
    expand: core.SenseGrepShowTool,
  }
  if (toolName === "status") return core.Instance.provide({ directory: root, profile, fn: () => core.Indexer.getStats() })
  if (["references", "impact", "trace"].includes(toolName)) {
    return core.Instance.provide({
      directory: root,
      profile,
      fn: async (): Promise<any> => toolName === "references"
        ? core.CodeGraph.findReferences(String(args.symbol ?? ""), args)
        : toolName === "impact"
          ? core.CodeGraph.impact(String(args.symbol ?? ""), args)
          : core.CodeGraph.trace(String(args.from ?? ""), String(args.to ?? ""), args),
    })
  }
  const factory = factories[toolName]
  if (!factory) throw new Error(`Unsupported daemon tool "${toolName}".`)
  const cacheKey = toolName === "expand" ? "show" : toolName
  if (!toolCache.has(cacheKey)) toolCache.set(cacheKey, factory.init())
  const tool = await toolCache.get(cacheKey)!
  const result = await core.Instance.provide({
    directory: root,
    profile,
    fn: () => tool.execute({ ...args, ...(toolName === "expand" ? { expand: true } : {}) }, {
      sessionID: "daemon",
      messageID: crypto.randomUUID(),
      agent: "sensegrep-daemon",
      abort: new AbortController().signal,
      metadata(_input: unknown) {},
    }),
  })
  if (toolName === "search" && (args.resultDetail ?? "compact") === "compact") {
    const { output: _output, results, ...rest } = result as any
    return {
      ...rest,
      results: Array.isArray(results) ? results.map((entry: any) => ({
        resultId: entry.resultId,
        file: entry.file,
        symbol: entry.symbolName,
        lines: [entry.startLine, entry.endLine],
        kind: entry.semanticKind ?? entry.symbolType ?? entry.type,
        score: entry.score,
        why: entry.whyMatched,
        estimatedTokens: entry.estimatedTokens,
        chunksMatched: entry.chunksMatched,
        snippetIntegrity: entry.snippetIntegrity,
        fileRole: entry.metadata?.fileRole,
      })) : results,
    }
  }
  if ((args.resultDetail ?? (toolName === "context" ? "content" : undefined)) !== "full") {
    const { output: _output, ...rest } = result as any
    return rest
  }
  return result
}

async function send(port: number, method: string, pathname: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path: pathname, headers: { "content-type": "application/json" } }, (res) => {
      let text = ""
      res.on("data", (chunk) => { text += chunk })
      res.on("end", () => {
        try { resolve(text ? JSON.parse(text) : {}) } catch { reject(new Error(text || `HTTP ${res.statusCode}`)) }
      })
    })
    req.on("error", reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

async function runServer(root: string, profile?: string): Promise<void> {
  const core = await import("@sensegrep/core")
  await core.Log.init({ print: true, level: "WARN" })
  const watcher = await core.IndexWatcher.start({ rootDir: root, entrypoint: "daemon", intervalMs: 60_000 }).catch(() => null)
  const startedAt = Date.now()
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ ok: true, root, profile: profile ?? "default", pid: process.pid, port: (server.address() as AddressInfo).port, uptimeMs: Date.now() - startedAt }))
      return
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.end(JSON.stringify({ ok: true }))
      setTimeout(async () => { await watcher?.stop(); server.close(() => process.exit(0)) }, 10).unref()
      return
    }
    if (req.method === "POST" && req.url === "/v1/tool") {
      let raw = ""
      for await (const chunk of req) raw += chunk
      try {
        const payload = JSON.parse(raw || "{}")
        const result = await invokeTool(core, root, payload.profile ?? profile, String(payload.tool ?? ""), payload.arguments ?? {})
        res.end(JSON.stringify({ ok: true, result }))
      } catch (error) {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, error: "Not found" }))
  })
  await new Promise<void>((resolve, reject) => server.listen(daemonPort(root), "127.0.0.1", resolve).once("error", reject))
}

export async function runDaemonCommand(action: string | undefined, flags: Flags, root: string): Promise<void> {
  root = path.resolve(root)
  const port = daemonPort(root)
  if (action === "run") return runServer(root, typeof flags.profile === "string" ? flags.profile : undefined)
  if (action === "start") {
    try {
      const health = await send(port, "GET", "/health")
      if (health.ok && health.root === root) { writeJson(health); return }
      if (health.ok) throw new Error(`Daemon port collision with root "${health.root}".`)
    } catch {}
    const child = spawn(process.execPath, [process.argv[1], "daemon", "run", "--root", root, ...(typeof flags.profile === "string" ? ["--profile", flags.profile] : [])], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        const health = await send(port, "GET", "/health")
        if (health.ok && health.root === root) { writeJson(health); return }
      } catch {}
    }
    throw new Error("Sensegrep daemon did not become ready.")
  }
  if (action === "status") {
    try { writeJson(await send(port, "GET", "/health")) } catch { writeJson({ ok: false, root, port }) }
    return
  }
  if (action === "stop") {
    try { writeJson(await send(port, "POST", "/shutdown")) } catch { writeJson({ ok: false, root, port, error: "daemon is not running" }) }
    return
  }
  if (action === "endpoint") {
    writeStdoutLine(`http://127.0.0.1:${port}/v1/tool`)
    return
  }
  if (action === "call") {
    if (typeof flags.tool !== "string") throw new Error("daemon call requires --tool <name>")
    let argumentsValue: Record<string, unknown> = {}
    if (typeof flags.arguments === "string") {
      const parsed = JSON.parse(flags.arguments)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--arguments must be a JSON object")
      argumentsValue = parsed
    }
    const response = await send(port, "POST", "/v1/tool", { tool: flags.tool, arguments: argumentsValue, profile: flags.profile })
    if (!response.ok) throw new Error(response.error ?? "Daemon call failed")
    writeJson(response.result)
    return
  }
  throw new Error("daemon requires start, status, stop, endpoint, call, or run")
}
