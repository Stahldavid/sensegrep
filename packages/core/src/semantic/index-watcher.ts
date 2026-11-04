import { RefreshQueue } from "./refresh-queue.js"
import path from "node:path"
import fs from "node:fs/promises"
import crypto from "node:crypto"
import { Instance } from "../project/instance.js"
import { Log } from "../util/log.js"
import { Indexer } from "./indexer.js"
import { Global } from "../global/index.js"
import { shouldIgnoreIndexedFile, clearProjectIndexFilterCache } from "./index-filters.js"

export namespace IndexWatcher {
  export type Options = {
    rootDir: string
    profile?: string
    intervalMs?: number
    onIndex?: (
      result: Awaited<ReturnType<typeof Indexer.indexProjectIncremental>>,
    ) => void
    onError?: (error: unknown) => void
  }

  export type Handle = {
    active: boolean
    stop: () => Promise<void>
  }

  const log = Log.create({ service: "semantic.watch" })
  const DEFAULT_INTERVAL_MS = 60_000
  const MAX_CONSECUTIVE_ERRORS = 3
  const LOCK_STALE_MS = 120_000 // 2 minutes — if PID check fails AND lock is older than this, consider stale
  let watcherPromise: Promise<typeof import("@parcel/watcher")> | null = null

  async function loadWatcher(): Promise<typeof import("@parcel/watcher")> {
    if (!watcherPromise) {
      watcherPromise = import("@parcel/watcher")
    }
    return watcherPromise
  }

  // ── Watcher lock (prevents duplicate watchers on the same project) ──

  function lockPath(rootDir: string, profile: string): string {
    const hash = crypto.createHash("sha256").update(`${rootDir}\0${profile}`).digest("hex")
    return path.join(Global.Path.data, ".lancedb", `watcher_${hash}`, "watcher.lock")
  }

  async function canonicalizeRootDir(rootDir: string): Promise<string> {
    const resolved = path.resolve(rootDir)
    try {
      return await fs.realpath(resolved)
    } catch {
      return path.normalize(resolved)
    }
  }

  function isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  async function acquireLock(rootDir: string, entrypoint: string, profile: string): Promise<string | null> {
    const lockFile = lockPath(rootDir, profile)
    await fs.mkdir(path.dirname(lockFile), { recursive: true })
    const token = crypto.randomUUID()

    while (true) {
      try {
        const handle = await fs.open(lockFile, "wx")
        try { await handle.writeFile(JSON.stringify({
          pid: process.pid,
          token,
          startedAt: Date.now(),
          entrypoint,
        })) } finally { await handle.close() }
        return token
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error
        const lock = await fs.readFile(lockFile, "utf8")
          .then((raw) => JSON.parse(raw) as { pid?: number; startedAt?: number; entrypoint?: string })
          .catch(() => null)
        if (typeof lock?.pid === "number" && isPidAlive(lock.pid)) {
          log.info("watcher already running, skipping", {
            existingPid: lock.pid,
            entrypoint: lock.entrypoint,
            rootDir,
          })
          return null
        }

        const stat = await fs.stat(lockFile).catch(() => null)
        const unreadableAndFresh = !lock && stat && Date.now() - stat.mtimeMs < LOCK_STALE_MS
        if (unreadableAndFresh) return null
        await fs.rm(lockFile, { force: true })
      }
    }
  }

  async function releaseLock(rootDir: string, token: string, profile: string): Promise<void> {
    try {
      const lockFile = lockPath(rootDir, profile)
      const raw = await fs.readFile(lockFile, "utf8")
      const lock = JSON.parse(raw) as { pid: number; token?: string }
      // Only remove if it's our lock
      if (lock.pid === process.pid && lock.token === token) {
        await fs.unlink(lockFile)
      }
    } catch {
      // Lock already gone
    }
  }

  function shouldIgnore(rootDir: string, fullPath: string): boolean {
    const rel = path.relative(rootDir, fullPath)
    if (!rel || rel.startsWith("..")) return true
    if ([".gitignore", ".ignore", ".sensegrepignore"].includes(path.basename(rel))) {
      clearProjectIndexFilterCache(rootDir)
      return false
    }
    if (path.basename(rel) === ".sensegreprc.json" || path.basename(rel) === "sensegrep.config.json") {
      clearProjectIndexFilterCache(rootDir)
      return false
    }
    if (shouldIgnoreIndexedFile(rootDir, rel)) return true
    if (!Indexer.isIndexableFile(rel)) return true
    return false
  }

  /**
   * Validate that the directory is suitable for watching
   */
  async function validateDirectory(rootDir: string): Promise<void> {
    // Check if directory exists
    const stat = await fs.stat(rootDir).catch(() => null)
    if (!stat?.isDirectory()) {
      throw new Error(`Not a valid directory: ${rootDir}`)
    }

    // Check for project markers (git, package.json, etc)
    const markers = [".git", "package.json", "go.mod", "Cargo.toml", "pyproject.toml", "pom.xml"]
    const hasMarker = await Promise.all(
      markers.map((marker) => fs.stat(path.join(rootDir, marker)).catch(() => null))
    ).then((results) => results.some((r) => r !== null))

    if (!hasMarker) {
      log.warn("directory lacks project markers, watch may be inefficient", { rootDir })
    }

    // Warn if watching a very broad directory (home directory, root, etc)
    const normalized = path.normalize(rootDir)
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (homeDir && path.normalize(homeDir) === normalized) {
      throw new Error(
        `Refusing to watch home directory: ${rootDir}. Please specify a project directory.`
      )
    }
  }

  // Never select a different project based on global indexing activity.
  async function resolveRootDir(explicitRoot?: string): Promise<string> {
    return explicitRoot ?? process.cwd()
  }

  export async function start(options: Options & { entrypoint?: string }): Promise<Handle> {
    // Auto-detect or use explicit root directory
    const profile = options.profile ?? Instance.profile
    if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new Error('Invalid watcher profile')
    const intervalMs=options.intervalMs??DEFAULT_INTERVAL_MS
    if (!Number.isFinite(intervalMs)||intervalMs<1||intervalMs>2_147_483_647) throw new Error('Invalid watcher interval')
    const resolvedRootDir = await resolveRootDir(options.rootDir)
    const rootDir = await canonicalizeRootDir(resolvedRootDir)

    // Validate directory before starting watcher
    await validateDirectory(rootDir)

    // Acquire lock — skip if another watcher is already running on this project
    const entrypoint = options.entrypoint ?? "unknown"
    const lockToken = await acquireLock(rootDir, entrypoint, profile)
    if (!lockToken) {
      return { active: false, stop: async () => {} }
    }

    let stopped = false
    const refresh = new RefreshQueue({
      intervalMs,
      maxFailures: MAX_CONSECUTIVE_ERRORS,
      run: async signal => {
        const result = await Instance.provide({directory:rootDir,profile,
          fn:()=>Indexer.indexProjectIncremental({signal,respectReleasedView:true})})
        try { options.onIndex?.(result) }
        catch (error) { log.warn('Watcher observer failed', {error:String(error)}) }
      },
      onError: (error, failures) => {
        log.error('watch index error', {error:String(error),failures,rootDir,profile})
        options.onError?.(error)
      },
    })
    const markDirty = (events: {path:string}[]) => {
      if (!stopped && events.some(event=>event?.path && !shouldIgnore(rootDir,event.path))) refresh.markDirty()
    }

    let subscription: Awaited<ReturnType<(typeof import("@parcel/watcher"))["subscribe"]>>
    try {
      const Watcher = await loadWatcher()
      subscription = await Watcher.subscribe(rootDir, (error, events) => {
      if (error) {
        log.error("watch error", { error: String(error) })
        try { options.onError?.(error) }
        catch (observerError) { log.warn('Watcher observer failed',{error:String(observerError)}) }
        return
      }
      if (!events || events.length === 0) return
      if (!stopped) markDirty(events)
    })
    } catch (error) {
      stopped = true
      await refresh.stop()
      await releaseLock(rootDir, lockToken, profile)
      throw error
    }

    return {
      active: true,
      stop: async () => {
        if (stopped) return
        stopped = true
        try { await subscription.unsubscribe() }
        finally {
          try { await refresh.stop() }
          finally { await releaseLock(rootDir, lockToken, profile) }
        }
      },
    }
  }
}
