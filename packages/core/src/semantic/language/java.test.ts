import { describe, expect, it } from "vitest"
import { chunk } from "./java.js"

const SAMPLE_JAVA = `package demo;
import java.util.List;

/** Service docs */
public abstract class UserService {
  private final String name;

  public UserService(String name) {
    this.name = name;
  }

  @Override
  public static int count(List<String> values) {
    if (values == null || values.isEmpty()) {
      return 0;
    }
    return values.size();
  }
}

interface Formatter {
  String format();
}

record UserRecord(String name) {}
`

describe("Java language support", () => {
  it("chunks Java declarations with semantic metadata", async () => {
    const chunks = await chunk(SAMPLE_JAVA, "src/UserService.java")

    expect(chunks.map((c) => c.symbolName)).toEqual(
      expect.arrayContaining(["UserService", "count", "Formatter", "UserRecord"])
    )

    const countChunk = chunks.find((c) => c.symbolName === "count")
    expect(countChunk).toMatchObject({
      symbolType: "method",
      variant: "static",
      isStatic: true,
      isExported: true,
      parentScope: "UserService",
      decorators: ["@Override"],
      language: "java",
    })
    expect(countChunk?.complexity).toBeGreaterThan(0)
    expect(countChunk?.imports).toContain("java.util.List")

    const classChunk = chunks.find((c) => c.symbolName === "UserService" && c.symbolType === "class")
    expect(classChunk).toMatchObject({
      symbolType: "class",
      variant: "abstract",
      isAbstract: true,
      hasDocumentation: true,
    })

    const interfaceChunk = chunks.find((c) => c.symbolName === "Formatter")
    expect(interfaceChunk).toMatchObject({
      symbolType: "type",
      variant: "interface",
    })

    const recordChunk = chunks.find((c) => c.symbolName === "UserRecord")
    expect(recordChunk).toMatchObject({
      symbolType: "class",
      variant: "record",
    })
  })
})
