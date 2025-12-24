#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

let corePromise: Promise<any> | null = null;
let toolPromise: Promise<any> | null = null;

async function loadCore() {
  if (!corePromise) {
    corePromise = import("@sensegrep/core");
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

const tools: Tool[] = [
  {
    name: "sensegrep.search",
    description: "Semantic + structural code search with optional regex filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        pattern: { type: "string", description: "Regex pattern filter" },
        limit: { type: "number", description: "Max results (default: 20)" },
        include: { type: "string", description: "File glob filter (e.g., 'src/**/*.ts')" },
        symbolType: {
          type: "string",
          enum: ["function", "class", "method", "interface", "type", "variable", "namespace", "enum"],
          description: "Filter by symbol type",
        },
        isExported: { type: "boolean", description: "Only exported symbols" },
        minComplexity: { type: "number", description: "Minimum cyclomatic complexity" },
        maxComplexity: { type: "number", description: "Maximum cyclomatic complexity" },
        hasDocumentation: { type: "boolean", description: "Require documentation" },
        language: {
          type: "string",
          enum: ["typescript", "javascript", "tsx", "jsx"],
          description: "Filter by language",
        },
        parentScope: { type: "string", description: "Parent scope/class name" },
        rerank: { type: "boolean", description: "Enable cross-encoder reranking" },
        embedModel: { type: "string", description: "Override embedding model" },
        embedDim: { type: "number", description: "Override embedding dimension" },
        rerankModel: { type: "string", description: "Override reranker model" },
        device: { type: "string", description: "cpu|cuda|webgpu|wasm" },
        provider: { type: "string", description: "local|gemini" },
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
        full: { type: "boolean", description: "Full reindex (default: incremental)" },
        embedModel: { type: "string", description: "Override embedding model" },
        embedDim: { type: "number", description: "Override embedding dimension" },
        rerankModel: { type: "string", description: "Override reranker model" },
        device: { type: "string", description: "cpu|cuda|webgpu|wasm" },
        provider: { type: "string", description: "local|gemini" },
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
  const provider = (args as any).provider === "local" || (args as any).provider === "gemini" ? (args as any).provider : undefined;
  const embedOverrides: Record<string, unknown> = {
    ...((args as any).embedModel ? { embedModel: String((args as any).embedModel) } : {}),
    ...((args as any).embedDim ? { embedDim: Number((args as any).embedDim) } : {}),
    ...((args as any).rerankModel ? { rerankModel: String((args as any).rerankModel) } : {}),
    ...((args as any).device ? { device: String((args as any).device) } : {}),
    ...(provider ? { provider } : {}),
  };

  try {
    if (name === "sensegrep.search") {
      const { core, tool } = await loadTool();
      const { rootDir: _root, ...toolArgs } = args as any;
      const { Instance, Embeddings } = core;
      const withOverrides = Object.keys(embedOverrides).length
        ? (fn: () => Promise<any>) => Embeddings.withConfig(embedOverrides as any, fn)
        : (fn: () => Promise<any>) => fn();
      const res = await withOverrides(() =>
        Instance.provide({
          directory: rootDir,
          fn: () =>
            tool.execute(toolArgs, {
              sessionID: "mcp",
              messageID: "mcp",
              agent: "sensegrep-mcp",
              abort: new AbortController().signal,
              metadata(_input: { title?: string; metadata?: unknown }) {},
            }),
        })
      );
      return {
        content: [{ type: "text", text: res.output }],
      };
    }

    if (name === "sensegrep.index") {
      const full = (args as any).full === true;
      const { core } = await loadTool();
      const { Indexer, Instance, Embeddings } = core;
      const withOverrides = Object.keys(embedOverrides).length
        ? (fn: () => Promise<any>) => Embeddings.withConfig(embedOverrides as any, fn)
        : (fn: () => Promise<any>) => fn();
      const result = (await withOverrides(() =>
        Instance.provide({
          directory: rootDir,
          fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
        })
      )) as any;
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
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
