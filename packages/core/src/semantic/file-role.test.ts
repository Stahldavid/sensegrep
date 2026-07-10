import { describe, expect, it } from "vitest"
import { classifyFileRole, fileRoleBoost } from "./file-role.js"

describe("file roles", () => {
  it.each([
    ["src/service.ts", "implementation"],
    ["src/service.test.ts", "test"],
    ["src/_generated/api.d.ts", "generated"],
    ["src/types/user.ts", "contract"],
    ["migrations/001.sql", "migration"],
    ["fixtures/users.json", "fixture"],
    ["dist/index.js", "build-artifact"],
  ] as const)("classifies %s as %s", (file, expected) => {
    expect(classifyFileRole(file, file.endsWith(".json") ? "config" : "code")).toBe(expected)
  })

  it("changes ranking according to purpose", () => {
    expect(fileRoleBoost("implementation", "understand")).toBeGreaterThan(fileRoleBoost("test", "understand"))
    expect(fileRoleBoost("test", "test")).toBeGreaterThan(fileRoleBoost("implementation", "test"))
  })
})
