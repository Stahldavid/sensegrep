import { describe, expect, it } from "vitest"
import { selectWorkspaceRoot } from "./workspace-roots.js"

describe("selectWorkspaceRoot", () => {
  it("prefers the active editor workspace", () => {
    expect(selectWorkspaceRoot(["C:/repo/api", "C:/repo/web"], "C:\\repo\\web", "C:/repo/api"))
      .toBe("C:/repo/web")
  })

  it("uses the configured fallback and then the first root", () => {
    expect(selectWorkspaceRoot(["/repo/api", "/repo/web"], undefined, "/repo/web")).toBe("/repo/web")
    expect(selectWorkspaceRoot(["/repo/api"], undefined, "/missing")).toBe("/repo/api")
  })
})
