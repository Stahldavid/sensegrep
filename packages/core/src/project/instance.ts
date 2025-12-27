import path from "path"
import fs from "fs/promises"

let currentDirectory = process.cwd()

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R | Promise<R> }): Promise<R> {
    const prev = currentDirectory
    const resolved = await fs.realpath(input.directory).catch(() => path.resolve(input.directory))
    currentDirectory = resolved
    await input.init?.()
    try {
      return await input.fn()
    } finally {
      currentDirectory = prev
    }
  },
  get directory() {
    return currentDirectory
  },
  get worktree() {
    return currentDirectory
  },
  get project() {
    return {
      id: "local",
      worktree: currentDirectory,
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
