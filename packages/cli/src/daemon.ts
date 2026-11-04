import { createServer, request as httpRequest } from "node:http"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import type { Flags } from "./search-commands.js"
import { writeJson, writeStdoutLine } from "./output.js"
import { cliProfile } from "./cli-profile.js"

type Core = typeof import("@sensegrep/core")
const toolCache = new Map<string, Promise<any>>()

function agentDetail(value: unknown, fallback: "minimal" | "content" = "minimal") {
  return value === "compact" || value === "content" || value === "diagnostic" || value === "full" || value === "minimal"
    ? value
    : fallback
}

function groupedDetail(value: unknown) {
  return value === "representatives" || value === "full" ? value : "summary"
}

// Each process publishes a separate immutable record. Never delete another process's
// record: a stale-record cleanup by concurrent starters can otherwise erase a new owner.
function registryDir(root: string): string {
  const canonical = process.platform === "win32" ? root.toLowerCase() : root
  const hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const base = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `sensegrep-${typeof process.getuid === "function" ? process.getuid() : os.userInfo().username}`)
  return path.join(base, "sensegrep-daemons", hash)
}

type DaemonRecord = { protocol: 1; root: string; instance: string; port: number }

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
    const result = await core.Instance.provide({
      directory: root,
      profile,
      fn: async (): Promise<any> => toolName === "references"
        ? core.CodeGraph.findReferences(String(args.symbol ?? ""), args)
        : toolName === "impact"
          ? core.CodeGraph.impact(String(args.symbol ?? ""), args)
          : core.CodeGraph.trace(String(args.from ?? ""), String(args.to ?? ""), args),
    })
    return core.projectAgentResponse({ ...result, command: toolName, status: result.status ?? "complete" }, {
      detail: agentDetail(args.resultDetail),
      diagnostics: args.resultDetail === "diagnostic",
    })
  }
  const factory = factories[toolName]
  if (!factory) throw new Error(`Unsupported daemon tool "${toolName}".`)
  const cacheKey = toolName === "expand" ? "show" : toolName
  if (!toolCache.has(cacheKey)) toolCache.set(cacheKey, factory.init())
  const tool = await toolCache.get(cacheKey)!
  const executionArgs = toolName === "survey" || toolName === "cluster"
    ? { ...args, jsonDetail: args.jsonDetail ?? "summary" }
    : args
  const result = await core.Instance.provide({
    directory: root,
    profile,
    fn: () => tool.execute({ ...executionArgs, ...(toolName === "expand" ? { expand: true } : {}) }, {
      sessionID: "daemon",
      messageID: crypto.randomUUID(),
      agent: "sensegrep-daemon",
      abort: new AbortController().signal,
      metadata(_input: unknown) {},
    }),
  })
  const detail = agentDetail(executionArgs.resultDetail, toolName === "context" || toolName === "show" || toolName === "expand" ? "content" : "minimal")
  const projected = core.projectAgentResponse(result, {
    detail,
    groupedDetail: groupedDetail(executionArgs.jsonDetail),
    diagnostics: detail === "diagnostic",
    includeFilterExplanations: executionArgs.explainFilters === true,
  })
  return core.enforceAgentOutputBudget(projected, { trailingNewline: false })
}

async function send(port: number, method: string, pathname: string, body?: unknown, instance?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path: pathname, headers: { "content-type": "application/json", ...(instance ? { "x-sensegrep-instance": instance } : {}) } }, (res) => {
      let text = ""
      res.on("data", (chunk) => { text += chunk })
      res.on("end", () => {
        try { resolve(text ? JSON.parse(text) : {}) } catch { reject(new Error(text || `HTTP ${res.statusCode}`)) }
      })
    })
    req.setTimeout(pathname === "/health" ? 2_000 : 120_000, () => req.destroy(new Error("Daemon health or request timed out.")))
    req.on("error", reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

async function runServer(root: string, profile?: string, watch = false): Promise<void> {
  let corePromise: Promise<Core> | undefined
  const loadCore = () => {
    corePromise ??= import("@sensegrep/core").then(async (core) => {
      await core.Log.init({ print: true, level: "WARN" })
      return core
    })
    return corePromise
  }
  let watcherPromise: Promise<{ active: boolean; stop: () => Promise<void> } | null> | undefined
  const startedAt = Date.now()
  const instance = crypto.randomUUID()
  let watchState = watch ? "starting" : "disabled"
  let watchError: string | undefined
  const directory = registryDir(root)
  const guardPath = path.join(directory, ".start-guard")
  const recordPath = path.join(directory, `${instance}.json`)
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    const watcher = await watcherPromise?.catch(() => null)
    await watcher?.stop()
    server.close(async () => {
      await fs.unlink(recordPath).catch(() => {})
      await fs.rm(guardPath, { recursive: true, force: true })
      process.exit(0)
    })
  }
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ ok: true, protocol: 1, instance, root, profile: profile ?? "default", watch: watchState, watchError, pid: process.pid, port: (server.address() as AddressInfo).port, uptimeMs: Date.now() - startedAt }))
      return
    }
    if (req.method === "POST" && req.headers["x-sensegrep-instance"] !== instance) {
      res.statusCode = 409
      res.end(JSON.stringify({ ok: false, error: "Daemon identity mismatch; rediscover the endpoint." }))
      return
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.end(JSON.stringify({ ok: true }))
      setTimeout(() => { void shutdown() }, 10).unref()
      return
    }
    if (req.method === "POST" && req.url === "/v1/tool") {
      let raw = ""
      for await (const chunk of req) raw += chunk
      try {
        const payload = JSON.parse(raw || "{}")
        const core = await loadCore()
        if (payload.profile !== undefined && payload.profile !== (profile ?? "default")) throw new Error("Daemon profile mismatch.")
        const result = await invokeTool(core, root, profile, String(payload.tool ?? ""), payload.arguments ?? {})
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
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  try { await fs.mkdir(guardPath, { mode: 0o700 }) }
  catch (error: any) {
    if (error?.code === "EEXIST") throw new Error(`Daemon startup guard already exists at ${guardPath}. Check the owner before recovering it.`)
    throw error
  }
  try {
    await fs.writeFile(path.join(guardPath, "owner.json"), JSON.stringify({ instance, root, pid: process.pid, startedAt }), { flag: "wx", mode: 0o600 })
    await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject))
    const record: DaemonRecord = { protocol: 1, root, instance, port: (server.address() as AddressInfo).port }
    const temporaryRecord = `${recordPath}.tmp`
    await fs.writeFile(temporaryRecord, JSON.stringify(record), { flag: "wx", mode: 0o600 })
    await fs.rename(temporaryRecord, recordPath)
  } catch (error) {
    server.close()
    await fs.rm(guardPath, { recursive: true, force: true })
    throw error
  }
  process.once("SIGTERM", () => { void shutdown() })
  process.once("SIGINT", () => { void shutdown() })
  if (watch) {
    watcherPromise = loadCore()
      .then((core) => core.IndexWatcher.start({ rootDir: root, profile, entrypoint: "daemon", intervalMs: 60_000, onError: (error) => { watchState = "error"; watchError = String(error) } }))
      .then((handle) => { const current = handle as typeof handle & { active: boolean }; watchState = current.active ? "active" : "owned-by-another-process"; return current })
      .catch((error) => { watchState = "error"; watchError = String(error); return null })
  }
}

export async function runDaemonCommand(action: string | undefined, flags: Flags, root: string): Promise<void> {
  root = await fs.realpath(path.resolve(root))
  const profile = cliProfile(typeof flags.profile === "string" ? flags.profile : undefined)
  if (action === "run") return runServer(root, profile, flags.watch === true)
  const healthCheck = async () => {
    let files: string[]
    try { files = await fs.readdir(registryDir(root)) }
    catch (error: any) { if (error?.code === "ENOENT") return null; throw error }
    const active: any[] = []
    for (const file of files) {
      if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue
      let record: DaemonRecord
      try { record = JSON.parse(await fs.readFile(path.join(registryDir(root), file), "utf8")) }
      catch (error: any) { if (error?.code === "ENOENT") continue; throw new Error(`Invalid daemon registry record ${file}.`) }
      if (record.protocol !== 1 || record.root !== root || `${record.instance}.json` !== file || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535) throw new Error(`Invalid daemon registry record ${file}.`)
      let health: any
      try { health = await send(record.port, "GET", "/health") }
      catch (error: any) { if (error?.code === "ECONNREFUSED" || error?.code === "ECONNRESET") continue; throw error }
      // A dead process's port may have been reused. Never contact it destructively.
      if (!health.ok || health.protocol !== 1 || health.instance !== record.instance || health.root !== root || health.port !== record.port) continue
      active.push(health)
    }
    if (active.length > 1) throw new Error(`Multiple daemons claim this checkout (PIDs: ${active.map((item) => Number.isInteger(item.pid) ? item.pid : "unknown").join(", ")}); inspect and stop the duplicate processes before continuing.`)
    return active[0] ?? null
  }
  const checkConfiguration = (health: any) => {
    const requestedProfile = profile
    if (health.profile !== requestedProfile || (flags.watch === true && health.watch !== "active")) {
      throw new Error(`Daemon configuration mismatch: requested profile ${requestedProfile}, watch ${flags.watch === true}; effective profile ${health.profile}, watch ${health.watch}.`)
    }
  }
  if (action === "start") {
    const existing = await healthCheck()
    if (existing) { checkConfiguration(existing); writeJson(existing); return }
    const child = spawn(process.execPath, [
      process.argv[1],
      "daemon",
      "run",
      "--root",
      root,
      "--profile", profile,
      ...(flags.watch === true ? ["--watch"] : []),
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const health = await healthCheck()
      if (health && !(flags.watch === true && health.watch === "starting")) { checkConfiguration(health); writeJson(health); return }
    }
    throw new Error(`Sensegrep daemon did not become ready. If no daemon is active, inspect the startup guard at ${path.join(registryDir(root), ".start-guard")} and follow the recovery instructions before removing it.`)
  }
  if (action === "status") {
    const health = await healthCheck()
    if (health) { writeJson(health); return }
    const guardPath = path.join(registryDir(root), ".start-guard")
    let guardPresent = false
    try { await fs.lstat(guardPath); guardPresent = true }
    catch (error: any) { if (error?.code !== "ENOENT") throw error }
    writeJson({ ok: false, root, profile, ...(guardPresent ? { recovery: {
      state: "guard-present", verificationRequired: true, resource: "daemon-startup-guard", path: guardPath,
      action: "A daemon may still be starting or unreachable. Verify that all daemon processes for this checkout have stopped before manually recovering this guard.",
    } } : {}) })
    return
  }
  if (action === "stop") {
    const health = await healthCheck()
    writeJson(health ? await send(health.port, "POST", "/shutdown", undefined, health.instance) : { ok: false, root, error: "daemon is not running" })
    return
  }
  if (action === "endpoint") {
    const health = await healthCheck()
    if (!health) throw new Error("Daemon is not running")
    writeStdoutLine(`http://127.0.0.1:${health.port}/v1/tool`)
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
    const health = await healthCheck()
    if (!health) throw new Error("Daemon is not running")
    checkConfiguration(health)
    const response = await send(health.port, "POST", "/v1/tool", { tool: flags.tool, arguments: argumentsValue, profile }, health.instance)
    if (!response.ok) throw new Error(response.error ?? "Daemon call failed")
    writeJson(response.result)
    return
  }
  throw new Error("daemon requires start, status, stop, endpoint, call, or run")
}
