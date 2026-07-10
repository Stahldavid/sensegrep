import { describe, expect, it } from "vitest"
import { parseEvalCases } from "./agent-commands.js"

describe("agent command cases", () => {
  it("parses task-level YAML evaluation cases", () => {
    expect(parseEvalCases(`
- query: "patient cannot enter before payment"
  expectedFirstFiles:
    - convex/actions/livekit.ts
  requiredSymbols:
    - assertPatientCanJoin
  requiredKinds:
    - routeHandler
`)).toEqual([{
      query: "patient cannot enter before payment",
      expectedFirstFiles: ["convex/actions/livekit.ts"],
      requiredSymbols: ["assertPatientCanJoin"],
      requiredKinds: ["routeHandler"],
    }])
  })
})
