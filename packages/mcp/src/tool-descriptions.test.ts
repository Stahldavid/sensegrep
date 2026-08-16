import { describe, expect, it } from "vitest";
import { LITERAL_TOOL_DESCRIPTION, SEARCH_TOOL_DESCRIPTION } from "./tool-descriptions.js";

describe("agent-facing search routing descriptions", () => {
  it("makes semantic search the default discovery tool", () => {
    expect(SEARCH_TOOL_DESCRIPTION).toMatch(/default tool for code discovery/i);
    expect(SEARCH_TOOL_DESCRIPTION).toMatch(/behavior, concept, or structure/i);
    expect(SEARCH_TOOL_DESCRIPTION).toMatch(/before literal search/i);
  });

  it("keeps literal search for exact verification rather than discovery", () => {
    expect(LITERAL_TOOL_DESCRIPTION).toMatch(/exact-text verification/i);
    expect(LITERAL_TOOL_DESCRIPTION).toMatch(/exhaustive occurrence checks/i);
    expect(LITERAL_TOOL_DESCRIPTION).toMatch(/after semantic discovery/i);
    expect(LITERAL_TOOL_DESCRIPTION).toMatch(/do not use it for behavior, concepts, or initial codebase exploration/i);
    expect(LITERAL_TOOL_DESCRIPTION).toMatch(/start with sensegrep_search/i);
  });
});
