#!/usr/bin/env node
// Synchronize only reviewed MCP skill files, never installed user/plugin state.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !["--check", "--write"].includes(arg)) || args.length > 1) {
  console.error("Usage: node scripts/sync-agent-skills.mjs [--check|--write]");
  process.exitCode = 2;
} else {
  const write = args[0] === "--write";
  const source = path.join(root, "plugins/sensegrep/skills/sensegrep");
  const destinations = ["plugin/sensegrep-plugin/skills/sensegrep", "plugin/sensegrep-cursor/skills/sensegrep"];
  const files = ["SKILL.md", "references/tool-reference.md"];
  let differences = 0;
  for (const relative of files) {
    const expected = await readFile(path.join(source, relative));
    for (const destination of destinations) {
      const target = path.join(root, destination, relative);
      let current;
      try { current = await readFile(target); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current?.equals(expected)) continue;
      differences++;
      if (write) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, expected);
      }
      console.log(`${write ? "updated" : "different"}: ${destination}/${relative}`);
    }
  }
  console.log(JSON.stringify({ mode: write ? "write" : "check", filesChecked: files.length * destinations.length, differences }));
  if (!write && differences) process.exitCode = 1;
}
