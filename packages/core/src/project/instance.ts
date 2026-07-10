import path from "path"
import fs from "fs/promises"
import { AsyncLocalStorage } from "node:async_hooks"

const defaultDirectory = process.cwd()
const directoryContext = new AsyncLocalStorage<string>()

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R | Promise<R> }): Promise<R> {
    const resolved = await fs.realpath(input.directory).catch(() => path.resolve(input.directory))
    return directoryContext.run(resolved, async () => {
      await input.init?.()
      return await input.fn()
    })
  },
  get directory() {
    return directoryContext.getStore() ?? defaultDirectory
  },
  get worktree() {
    return directoryContext.getStore() ?? defaultDirectory
  },
  get project() {
    const directory = directoryContext.getStore() ?? defaultDirectory
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
