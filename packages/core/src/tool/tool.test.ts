import z from "zod"
import { describe, expect, it } from "vitest"
import { Tool } from "./tool.js"

describe("Tool.define", () => {
  it("executes with parsed defaults and transformations", async () => {
    const definition = Tool.define("example", {
      description: "test tool",
      parameters: z.object({ count: z.coerce.number().int().default(3) }),
      async execute(args) {
        return { title: "example", metadata: { count: args.count }, output: String(args.count) }
      },
    })
    const tool = await definition.init()
    const context = {
      sessionID: "test",
      messageID: "test",
      agent: "test",
      abort: new AbortController().signal,
      metadata() {},
    }

    await expect(tool.execute({} as never, context)).resolves.toMatchObject({ output: "3" })
    await expect(tool.execute({ count: "4" } as never, context)).resolves.toMatchObject({ output: "4" })

    const initializedAgain = await definition.init()
    await expect(initializedAgain.execute({ count: "5" } as never, context)).resolves.toMatchObject({ output: "5" })
  })
})
