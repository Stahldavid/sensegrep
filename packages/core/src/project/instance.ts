import path from "path"
import fs from "fs/promises"
import { AsyncLocalStorage } from "node:async_hooks"

const defaultDirectory = process.cwd()
type InstanceContext = { directory: string; profile: string }
const directoryContext = new AsyncLocalStorage<InstanceContext>()

function normalizeProfile(profile?: string): string {
  const value = (profile || process.env.SENSEGREP_PROFILE || "default").trim()
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid sensegrep profile "${value}". Use letters, numbers, dot, underscore, or hyphen.`)
  }
  return value
}

export const Instance = {
  async provide<R>(input: { directory: string; profile?: string; init?: () => Promise<any>; fn: () => R | Promise<R> }): Promise<R> {
    const resolved = await fs.realpath(input.directory).catch(() => path.resolve(input.directory))
    return directoryContext.run({ directory: resolved, profile: normalizeProfile(input.profile) }, async () => {
      await input.init?.()
      return await input.fn()
    })
  },
  get directory() {
    return directoryContext.getStore()?.directory ?? defaultDirectory
  },
  get worktree() {
    return directoryContext.getStore()?.directory ?? defaultDirectory
  },
  get profile() {
    return directoryContext.getStore()?.profile ?? normalizeProfile()
  },
  get project() {
    const directory = directoryContext.getStore()?.directory ?? defaultDirectory
    return {
      id: "workspace",
      worktree: directory,
      time: { created: Date.now(), updated: Date.now() },
    } as any
  },
  state<S>(init: () => S, _dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    const value = init()
    return () => value
  },
  async dispose() {},
  async disposeAll() {},
}
