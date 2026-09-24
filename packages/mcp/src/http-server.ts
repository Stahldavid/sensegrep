#!/usr/bin/env node
import { createServer as createNodeServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMcpHandler,
  Server,
  type McpHttpHandler,
  type McpRequestContext,
  type Tool,
} from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { callSensegrepTool, listSensegrepTools } from "./server.js";

const DEFAULT_PORT = 7337;
const DEFAULT_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";

export type SensegrepHttpHandlerOptions = {
  rootDir?: string;
  onServerCreated?: (context: McpRequestContext) => void;
};

/**
 * Experimental local HTTP surface. The factory is invoked once per request by
 * createMcpHandler, so neither Server nor transport state crosses requests.
 * Production deployments must replace the fixed local root with an authorized
 * workspaceId resolver backed by persistent index storage.
 */
export function createSensegrepHttpHandler(
  options: SensegrepHttpHandlerOptions = {},
): McpHttpHandler {
  const fixedRootDir = path.resolve(options.rootDir ?? process.env.SENSEGREP_ROOT ?? process.cwd());

  return createMcpHandler(async (context) => {
    options.onServerCreated?.(context);
    const server = new Server(
      { name: "sensegrep", version: "1.17.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler("tools/list", async () => ({
      tools: await listSensegrepTools("http-query-only") as Tool[],
    }));
    server.setRequestHandler("tools/call", async (request, requestContext) => {
      const tools = await listSensegrepTools("http-query-only");
      const advertisedTool = tools.find((tool) => tool.name === request.params.name);
      const result = await callSensegrepTool(
        request.params.name,
        request.params.arguments,
        {
          signal: requestContext.mcpReq.signal,
          mode: "http-query-only",
          fixedRootDir,
          requestId: requestContext.mcpReq.id,
        },
      );
      return server.projectCallToolResult(result as any, advertisedTool?.outputSchema);
    });

    return server;
  }, {
    legacy: "stateless",
    onerror: (error) => console.error("[sensegrep] HTTP MCP error:", error),
  });
}

export async function startSensegrepHttpServer(): Promise<void> {
  const rawPort = process.env.SENSEGREP_MCP_HTTP_PORT;
  const port = rawPort === undefined ? DEFAULT_PORT : Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SENSEGREP_MCP_HTTP_PORT must be an integer between 1 and 65535");
  }

  const handler = createSensegrepHttpHandler();
  const handleMcp = toNodeHandler(handler, {
    onerror: (error) => console.error("[sensegrep] HTTP adapter error:", error),
  });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const server = createNodeServer(async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (requestPath !== MCP_PATH) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST", "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    await handleMcp(request, response);
  });

  const close = async () => {
    await handler.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, DEFAULT_HOST, resolve);
  });
  console.error(`[sensegrep] experimental stateless HTTP MCP listening at http://${DEFAULT_HOST}:${port}${MCP_PATH}`);
  console.error("[sensegrep] query-only; production requires authorized workspaceId resolution and persistent storage");
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  startSensegrepHttpServer().catch((error) => {
    console.error("HTTP server error:", error);
    process.exit(1);
  });
}
