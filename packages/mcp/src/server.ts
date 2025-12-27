#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let corePromise: Promise<any> | null = null;
let toolPromise: Promise<any> | null = null;
const WATCH_INTERVAL_MS = 60_000;
let watchHandle: { stop: () => Promise<void> } | null = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadCore() {
  if (!corePromise) {
    corePromise = import("@sensegrep/core").catch(async (error) => {
      const fallbackUrl = pathToFileURL(
        path.join(__dirname, "..", "..", "core", "dist", "index.js"),
      ).href;
      try {
        return await import(fallbackUrl);
      } catch (fallbackError) {
        const message = fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
        const err = new Error(
          `Failed to load @sensegrep/core. Fallback also failed: ${message}`,
        );
        (err as any).cause = error;
        throw err;
      }
    });
  }
  return corePromise;
}

async function loadTool() {
  const core = await loadCore();
  if (!toolPromise) toolPromise = core.SenseGrepTool.init();
  const tool = await toolPromise;
  return { core, tool };
}

type IndexResult = {
  mode?: string;
  files?: number;
  chunks?: number;
  skipped?: number;
  removed?: number;
  duration?: number;
};

function isIncremental(result: IndexResult): result is IndexResult & { mode: "incremental" } {
  return (result as any).mode === "incremental";
}

function formatIndexResult(result: IndexResult): string {
  const duration = ((result.duration ?? 0) / 1000).toFixed(1);
  if (isIncremental(result)) {
    return `Indexed ${result.files ?? 0} files (${result.chunks ?? 0} chunks), skipped ${result.skipped ?? 0}, removed ${result.removed ?? 0} in ${duration}s`;
  }
  return `Indexed ${result.files ?? 0} files (${result.chunks ?? 0} chunks) in ${duration}s`;
}

function watchEnabled(): boolean {
  const raw = process.env.SENSEGREP_WATCH;
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

async function startWatch() {
  if (!watchEnabled()) return;
  if (watchHandle) return;
  const { IndexWatcher } = await loadCore();
  // Use SENSEGREP_ROOT if set, otherwise let watcher auto-detect from most recent index
  const rootDir = process.env.SENSEGREP_ROOT;
  try {
    watchHandle = await IndexWatcher.start({
      rootDir: rootDir!, // Will auto-detect if undefined
      intervalMs: WATCH_INTERVAL_MS,
      onIndex: (result: IndexResult) => {
        const message = formatIndexResult(result);
        if (message) console.error(`[sensegrep] ${message}`);
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[sensegrep] watch error: ${message}`);
      },
    });
    console.error(`[sensegrep] watching (reindex at most once per minute)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sensegrep] failed to start watcher: ${message}`);
    // Don't throw - allow MCP to continue without watcher
  }
}

async function stopWatch() {
  if (watchHandle) {
    await watchHandle.stop();
    watchHandle = null;
  }
}

const tools: Tool[] = [
  {
    name: "sensegrep.search",
    description: "Semantic + structural code search with optional regex filters. Automatically uses the embedding model from the index.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        pattern: { type: "string", description: "Regex pattern filter" },
        limit: { type: "number", description: "Max results (default: 20)" },
        include: { type: "string", description: "File glob filter (e.g., 'src/**/*.ts')" },
        symbol: { type: "string", description: "Filter by symbol name" },
        name: { type: "string", description: "Alias for symbol name" },
        symbolType: {
          type: "string",
          enum: ["function", "class", "method", "interface", "type", "variable", "namespace", "enum"],
          description: "Filter by symbol type",
        },
        isExported: { type: "boolean", description: "Only exported symbols" },
        minComplexity: { type: "number", description: "Minimum cyclomatic complexity" },
        maxComplexity: { type: "number", description: "Maximum cyclomatic complexity" },
        minScore: { type: "number", description: "Minimum relevance score 0-1" },
        maxPerFile: { type: "number", description: "Max results per file (default: 1)" },
        maxPerSymbol: { type: "number", description: "Max results per symbol (default: 1)" },
        hasDocumentation: { type: "boolean", description: "Require documentation" },
        language: {
          type: "string",
          enum: ["typescript", "javascript", "tsx", "jsx"],
          description: "Filter by language",
        },
        parentScope: { type: "string", description: "Parent scope/class name" },
        imports: { type: "string", description: "Filter by imported module name (e.g., 'react')" },
        rerank: { type: "boolean", description: "Enable cross-encoder reranking" },
        rootDir: { type: "string", description: "Root directory (default: cwd)" },
      },
      required: ["query"],
    },
  },
  {
    name: "sensegrep.index",
    description: "Create or update a semantic index for the given root directory.",
    inputSchema: {
      type: "object",
      properties: {
        rootDir: { type: "string", description: "Root directory to index" },
        mode: {
          type: "string",
          enum: ["incremental", "full"],
          description: "Index mode (default: incremental)",
        },
      },
    },
  },
  {
    name: "sensegrep.stats",
    description: "Get index stats for the given root directory.",
    inputSchema: {
      type: "object",
      properties: {
        rootDir: { type: "string", description: "Root directory" },
      },
    },
  },
];

const server = new Server(
  {
    name: "sensegrep",
    version: "0.1.6",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const rootDir = (args as any).rootDir || process.env.SENSEGREP_ROOT || process.cwd();

  try {
    if (name === "sensegrep.search") {
      const { core, tool } = await loadTool();
      const { rootDir: _root, ...toolArgs } = args as any;
      const { Instance } = core;
      // Search tool now reads embeddings config from index automatically
      const res = await Instance.provide({
        directory: rootDir,
        fn: () =>
          tool.execute(toolArgs, {
            sessionID: "mcp",
            messageID: "mcp",
            agent: "sensegrep-mcp",
            abort: new AbortController().signal,
            metadata(_input: { title?: string; metadata?: unknown }) {},
          }),
      });
      return {
        content: [{ type: "text", text: res.output }],
      };
    }

    if (name === "sensegrep.index") {
      const { core } = await loadTool();
      const { Indexer, Instance } = core;
      const mode = String((args as any).mode ?? "incremental").toLowerCase();
      const full = mode === "full";
      const result = (await Instance.provide({
        directory: rootDir,
        fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
      })) as any;
      const files = result.files ?? 0;
      const chunks = result.chunks ?? 0;
      const skipped = result.skipped ?? 0;
      const removed = result.removed ?? 0;
      const durationMs = result.duration ?? 0;
      const duration = (durationMs / 1000).toFixed(1);
      const text = isIncremental(result)
        ? `Indexed ${files} files (${chunks} chunks), skipped ${skipped}, removed ${removed} in ${duration}s`
        : `Indexed ${files} files (${chunks} chunks) in ${duration}s`;
      return {
        content: [{ type: "text", text }],
      };
    }

    if (name === "sensegrep.stats") {
      const { core } = await loadTool();
      const { Indexer, Instance } = core;
      const stats = await Instance.provide({
        directory: rootDir,
        fn: () => Indexer.getStats(),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error?.message || "Internal error"}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  void startWatch();

  // Setup cleanup handlers
  const cleanup = async () => {
    await stopWatch();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
