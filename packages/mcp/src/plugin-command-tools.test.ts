import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const COMMANDS = [
  "plugin/sensegrep-plugin/commands/sensegrep-find.md",
  "plugin/sensegrep-plugin/commands/sensegrep-duplicates.md",
  "plugin/sensegrep-plugin/commands/sensegrep-health.md",
];
const AGENT_GUIDANCE = [
  "plugin/sensegrep-plugin/skills/sensegrep/SKILL.md",
  "plugin/sensegrep-cursor/skills/sensegrep/SKILL.md",
  "plugins/sensegrep/skills/sensegrep/SKILL.md",
  "skills/sensegrep-cli/SKILL.md",
];

function extractPluginMcpTools(markdown: string): string[] {
  const matches = markdown.matchAll(/mcp__plugin_sensegrep_sensegrep__(sensegrep_[a-z_-]+)/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

describe("Claude plugin command MCP tool references", () => {
  it("only references tools exposed by the sensegrep MCP server", async () => {
    const serverSource = await readFile(path.join(ROOT, "packages/mcp/src/server.ts"), "utf8");
    const exposedTools = new Set([...serverSource.matchAll(/name:\s*TOOL_NAMES\.([a-zA-Z]+)/g)].map((match) => match[1]));
    const toolNameMap: Record<string, string> = {
      search: "sensegrep_search",
      survey: "sensegrep_survey",
      cluster: "sensegrep_cluster",
      detectDuplicates: "sensegrep_detect_duplicates",
      index: "sensegrep_index",
    };
    const allowed = new Set([...exposedTools].map((key) => toolNameMap[key]).filter(Boolean));

    for (const command of COMMANDS) {
      const markdown = await readFile(path.join(ROOT, command), "utf8");
      const referencedTools = extractPluginMcpTools(markdown);
      expect(referencedTools, command).not.toContain("sensegrep_languages");
      expect(referencedTools, command).not.toContain("sensegrep_stats");
      for (const tool of referencedTools) {
        expect(allowed, `${command} references ${tool}`).toContain(tool);
      }
    }
  });

  it("keeps conceptual and exhaustive-text routes in complete skill distributions", async () => {
    const canonical = "plugins/sensegrep/skills/sensegrep";
    for (const guidance of AGENT_GUIDANCE) {
      const markdown = await readFile(path.join(ROOT, guidance), "utf8");
      expect(markdown, guidance).toMatch(/conceptual[^\n]*`sensegrep(?:_search| search)`/i);
      expect(markdown, guidance).toMatch(/(?:exact strings|known path)[^\n]*(?:direct text|`rg`)/i);
      const references = [...markdown.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map((match) => match[1]);
      expect(references.length, guidance).toBeGreaterThan(0);
      for (const reference of new Set(references)) {
        const text = await readFile(path.join(ROOT, path.dirname(guidance), reference), "utf8");
        expect(text.trim(), `${guidance}: ${reference}`).not.toBe("");
        if (guidance.includes("/skills/sensegrep/")) {
          expect(text, `${guidance}: ${reference}`).toBe(await readFile(path.join(ROOT, canonical, reference), "utf8"));
        }
      }
    }
  });
});
