import path from "node:path"
import fs from "node:fs/promises"
import * as Watcher from "@parcel/watcher"
import { FileIgnore } from "../file/ignore.js"
import { Instance } from "../project/instance.js"
import { Log } from "../util/log.js"
import { Indexer } from "./indexer.js"

export namespace IndexWatcher {
  export type Options = {
    rootDir: string
    intervalMs?: number
    onIndex?: (
      result: Awaited<ReturnType<typeof Indexer.indexProjectIncremental>>,
    ) => void
    onError?: (error: unknown) => void
  }

  export type Handle = {
    stop: () => Promise<void>
  }

  const log = Log.create({ service: "semantic.watch" })
  const DEFAULT_INTERVAL_MS = 60_000
  const MAX_CONSECUTIVE_ERRORS = 3
  const BACKOFF_MULTIPLIER = 2

  function shouldIgnore(rootDir: string, fullPath: string): boolean {
    const rel = path.relative(rootDir, fullPath)
    if (!rel || rel.startsWith("..")) return true
    if (path.basename(rel) === ".gitignore") return true
    if (FileIgnore.match(rel)) return true
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

  /**
   * Auto-detect the project root directory to watch
   * Priority:
   * 1. Explicit rootDir parameter
   * 2. Current working directory if it has an index
   * 3. Most recently indexed project
   * 4. Fallback to cwd
   */
  async function resolveRootDir(explicitRoot?: string): Promise<string> {
    // If explicitly provided, use it
    if (explicitRoot) return explicitRoot

    const cwd = process.cwd()

    // Check if cwd has an index
    const { VectorStore } = await import("./lancedb.js")
    const hasIndex = await VectorStore.hasCollection(cwd)
    if (hasIndex) {
      log.info("using current directory with existing index", { rootDir: cwd })
      return cwd
    }

    // Try to find most recent indexed project
    const mostRecent = await VectorStore.getMostRecentIndexedProject()
    if (mostRecent) {
      log.info("using most recently indexed project", { rootDir: mostRecent })
      return mostRecent
    }

    // Fallback to cwd (will be validated)
    log.warn("no indexed projects found, using current directory", { rootDir: cwd })
    return cwd
  }

  export async function start(options: Options): Promise<Handle> {
    // Auto-detect or use explicit root directory
    const rootDir = await resolveRootDir(options.rootDir)

    // Validate directory before starting watcher
    await validateDirectory(rootDir)

    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    let dirty = false
    let running = false
    let pending = false
    let consecutiveErrors = 0
    let currentInterval = intervalMs
    let intervalHandle: NodeJS.Timeout | null = null

    const markDirty = (events: { path: string }[]) => {
      for (const event of events) {
        if (!event?.path) continue
        if (shouldIgnore(rootDir, event.path)) continue
        dirty = true
        break
      }
    }

    const flush = async () => {
      if (running) {
        pending = true
        return
      }
      if (!dirty) return

      // Check if we've hit max consecutive errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.error("max consecutive errors reached, pausing watcher", {
          errors: consecutiveErrors,
          rootDir,
        })
        options.onError?.(
          new Error(
            `Watcher paused after ${consecutiveErrors} consecutive errors. Check directory: ${rootDir}`
          )
        )
        return
      }

      running = true
      dirty = false
      try {
        const result = await Instance.provide({
          directory: rootDir,
          fn: () => Indexer.indexProjectIncremental(),
        })
        options.onIndex?.(result as any)

        // Success - reset error count and interval
        consecutiveErrors = 0
        if (currentInterval !== intervalMs) {
          currentInterval = intervalMs
          resetInterval()
        }
      } catch (error) {
        consecutiveErrors++
        log.error("watch index error", {
          error: String(error),
          consecutiveErrors,
          rootDir,
        })
        options.onError?.(error)

        // Apply backoff strategy
        if (consecutiveErrors > 1 && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
          currentInterval = intervalMs * Math.pow(BACKOFF_MULTIPLIER, consecutiveErrors - 1)
          log.warn("applying backoff strategy", {
            newInterval: currentInterval,
            consecutiveErrors,
          })
          resetInterval()
        }
      } finally {
        running = false
        if (pending) {
          pending = false
          dirty = true
          void flush()
        }
      }
    }

    const resetInterval = () => {
      if (intervalHandle) {
        clearInterval(intervalHandle)
      }
      intervalHandle = setInterval(() => {
        void flush()
      }, currentInterval)
      intervalHandle.unref?.()
    }

    resetInterval()

    const subscription = await Watcher.subscribe(rootDir, (error, events) => {
      if (error) {
        log.error("watch error", { error: String(error) })
        options.onError?.(error)
        return
      }
      if (!events || events.length === 0) return
      markDirty(events)
    })

    return {
      stop: async () => {
        if (intervalHandle) {
          clearInterval(intervalHandle)
        }
        await subscription.unsubscribe()
      },
    }
  }
}
