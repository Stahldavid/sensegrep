import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { createSensegrepHttpHandler } from "./http-server.js";
import { callSensegrepTool, listSensegrepTools } from "./server.js";

const handlers: Array<{ close: () => Promise<void> }> = [];

function modernRequest(method: string, id: number) {
  return new Request("http://127.0.0.1:7337/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "sensegrep-test", version: "1.0.0" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
}

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
});

describe("stateless query-only HTTP MCP", () => {
  it("exposes query tools but neither index mutation nor a caller-selected root", async () => {
    const tools = await listSensegrepTools("http-query-only");
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("sensegrep_search");
    expect(names).toContain("sensegrep_literal");
    expect(names).toContain("sensegrep_context");
    expect(names).toContain("sensegrep_survey");
    expect(names).toContain("sensegrep_cluster");
    expect(names).toContain("sensegrep_detect_duplicates");
    expect(names).toContain("sensegrep_graph");
    expect(names).not.toContain("sensegrep_index");
    for (const tool of tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty("rootDir");
    }
  });

  it("creates a fresh MCP server for every modern HTTP request", async () => {
    const creations: string[] = [];
    const handler = createSensegrepHttpHandler({
      onServerCreated: (context) => creations.push(context.era),
    });
    handlers.push(handler);

    const first = await handler.fetch(modernRequest("server/discover", 1));
    const second = await handler.fetch(modernRequest("server/discover", 2));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(creations).toEqual(["modern", "modern"]);
  });

  it("rejects direct index calls even when a client bypasses tools/list", async () => {
    const result = await callSensegrepTool("sensegrep_index", {}, {
      signal: new AbortController().signal,
      mode: "http-query-only",
      fixedRootDir: process.cwd(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("query-only HTTP endpoint");
  });

  it("serves the query-only catalog over the 2026-07-28 tools/list contract", async () => {
    const handler = createSensegrepHttpHandler();
    handlers.push(handler);

    const response = await handler.fetch(modernRequest("tools/list", 3));
    const payload = await response.json() as {
      result?: { tools?: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> };
    };
    const names = payload.result?.tools?.map((tool) => tool.name) ?? [];

    expect(response.status).toBe(200);
    expect(names).toContain("sensegrep_search");
    expect(names).not.toContain("sensegrep_index");
    expect(payload.result?.tools?.every((tool) => !("rootDir" in (tool.inputSchema.properties ?? {})))).toBe(true);
  });
});
