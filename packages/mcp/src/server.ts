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
import { DuplicateToolArgsSchema, GraphToolArgsSchema, IndexToolArgsSchema, toInputSchema, toRootedInputSchema } from "./tool-inputs.js";

let corePromise: Promise<any> | null = null;
let searchToolPromise: Promise<any> | null = null;
let contextToolPromise: Promise<any> | null = null;
let surveyToolPromise: Promise<any> | null = null;
let clusterToolPromise: Promise<any> | null = null;
let showToolPromise: Promise<any> | null = null;
let cachedTools: Tool[] | null = null;
const WATCH_INTERVAL_MS = 60_000;
let watchHandle: { stop: () => Promise<void> } | null = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOL_NAMES = {
  search: "sensegrep_search",
  literal: "sensegrep_literal",
  show: "sensegrep_show",
  context: "sensegrep_context",
  survey: "sensegrep_survey",
  cluster: "sensegrep_cluster",
  detectDuplicates: "sensegrep_detect_duplicates",
  index: "sensegrep_index",
  graph: "sensegrep_graph",
} as const;

function matchesToolName(name: string, canonical: string, ...legacy: string[]): boolean {
  return name === canonical || legacy.includes(name);
}

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
  if (!searchToolPromise) searchToolPromise = core.SenseGrepTool.init();
  const tool = await searchToolPromise;
  return { core, tool };
}

async function loadContextTool() {
  const core = await loadCore();
  if (!contextToolPromise) contextToolPromise = core.SenseGrepContextTool.init();
  const tool = await contextToolPromise;
  return { core, tool };
}

async function loadSurveyTool() {
  const core = await loadCore();
  if (!surveyToolPromise) surveyToolPromise = core.SenseGrepSurveyTool.init();
  const tool = await surveyToolPromise;
  return { core, tool };
}

async function loadClusterTool() {
  const core = await loadCore();
  if (!clusterToolPromise) clusterToolPromise = core.SenseGrepClusterTool.init();
  const tool = await clusterToolPromise;
  return { core, tool };
}

async function loadShowTool() {
  const core = await loadCore();
  if (!showToolPromise) showToolPromise = core.SenseGrepShowTool.init();
  return { core, tool: await showToolPromise };
}

function compactSearchResponse(res: any) {
  const { output: _output, ...rest } = res;
  return {
    ...rest,
    results: Array.isArray(res.results) ? res.results.map((entry: any) => ({
      resultId: entry.resultId,
      file: entry.file,
      startLine: entry.startLine,
      endLine: entry.endLine,
      symbolName: entry.symbolName,
      symbolType: entry.symbolType,
      type: entry.type,
      language: entry.language,
      parentScope: entry.parentScope,
      semanticKind: entry.semanticKind,
      framework: entry.framework,
      fileRole: entry.fileRole ?? entry.metadata?.fileRole,
      score: entry.score,
      rawDistance: entry.rawDistance,
      distanceMetric: entry.distanceMetric,
      confidence: entry.confidence,
      isWeakMatch: entry.isWeakMatch,
      whyMatched: entry.whyMatched,
      filterMatches: entry.filterMatches,
      estimatedTokens: entry.estimatedTokens,
      chunksMatched: entry.chunksMatched,
      snippetIntegrity: entry.snippetIntegrity,
    })) : res.results,
  };
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
      entrypoint: "mcp",
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

async function generateTools(): Promise<Tool[]> {
  if (cachedTools) return cachedTools;

  const core = await loadCore();
  const caps = core.getLanguageCapabilities();

  // Format variants for description
  const variantDesc = caps.variants
    .slice(0, 10)
    .map((v: any) => `${v.name} (${v.languages.join("/")})`)
    .join(", ");

  cachedTools = [
    {
      name: TOOL_NAMES.search,
      description: `Semantic + structural code search. Languages: ${caps.languages.join(", ")}`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Semantic search query: pass a natural-language sentence/text or a code snippet, not isolated keywords" },
          pattern: { type: "string", description: "Regex pattern filter" },
          limit: { type: "number", description: "Max results (default: 20)" },
          include: { type: "string", description: "File glob include filter (e.g., 'src/**/*.ts')" },
          exclude: { type: "string", description: "File glob exclude filter (e.g., '*.md' or 'docs/**')" },
          symbol: { type: "string", description: "Filter by symbol name" },
          name: { type: "string", description: "Alias for symbol name" },
          exact: { type: "boolean", description: "Prefer exact symbol-name lookup for identifier queries" },
          symbolType: {
            type: "string",
            enum: [...caps.symbolTypes],
            description: "Semantic symbol type",
          },
          variant: {
            type: "string",
            description: `Language-specific variant. Available: ${variantDesc}...`,
          },
          decorator: {
            type: "string",
            description: `Filter by decorator (${caps.decorators.slice(0, 5).join(", ")}...)`,
          },
          isExported: { type: "boolean", description: "Only exported symbols" },
          isAsync: { type: "boolean", description: "Only async functions/methods" },
          isStatic: { type: "boolean", description: "Only static methods" },
          isAbstract: { type: "boolean", description: "Only abstract classes/methods" },
          minComplexity: { type: "number", description: "Minimum cyclomatic complexity" },
          maxComplexity: { type: "number", description: "Maximum cyclomatic complexity" },
          minScore: { type: "number", description: "Minimum relevance score 0-1" },
          maxPerFile: { type: "number", description: "Max results per file (default: 1)" },
          maxPerSymbol: { type: "number", description: "Max results per symbol (default: 1)" },
          hasDocumentation: { type: "boolean", description: "Require documentation" },
          language: {
            type: "string",
            enum: [...caps.languages],
            description: "Filter by programming language",
          },
          parentScope: { type: "string", description: "Parent scope/class name" },
          imports: { type: "string", description: "Filter by imported module name" },
          semanticKind: {
            type: "string",
            enum: caps.semanticKinds.map((kind: any) => kind.name),
            description: "Framework-aware kind (convexMutation, convexAction, reactComponent, reactHook, routeHandler, etc.)",
          },
          explainFilters: { type: "boolean", description: "Include deterministic filter match explanations in JSON results" },
          strictParent: { type: "boolean", description: "Require strict parent metadata when filtering by parent" },
          strictImports: { type: "boolean", description: "Require strict import metadata when filtering by imports" },
          shake: { type: "boolean", description: "Enable semantic tree-shaking in output (default: true)" },
          rerank: {
            type: "boolean",
            description: "Compatibility flag. Remote-only mode keeps semantic ranking unchanged",
          },
          rootDir: { type: "string", description: "Root directory (default: cwd)" },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.survey,
      description: "Theme-oriented code survey. Groups semantically related hits into reading domains and returns representative tree-shaken snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language theme query to map a domain or feature area" },
          pattern: { type: "string", description: "Optional regex pattern filter" },
          limit: { type: "number", description: "Max groups to return (default: 5)" },
          rawLimit: { type: "number", description: "Raw matches to gather before grouping (default: 60)" },
          perGroup: { type: "number", description: "Representative snippets per group (default: 2)" },
          include: { type: "string", description: "File glob include filter (e.g., 'src/**/*.ts')" },
          exclude: { type: "string", description: "File glob exclude filter (e.g., '*.md' or 'docs/**')" },
          symbol: { type: "string", description: "Filter by symbol name" },
          name: { type: "string", description: "Alias for symbol name" },
          symbolType: {
            type: "string",
            enum: [...caps.symbolTypes],
            description: "Semantic symbol type",
          },
          variant: {
            type: "string",
            description: `Language-specific variant. Available: ${variantDesc}...`,
          },
          decorator: {
            type: "string",
            description: `Filter by decorator (${caps.decorators.slice(0, 5).join(", ")}...)`,
          },
          isExported: { type: "boolean", description: "Only exported symbols" },
          isAsync: { type: "boolean", description: "Only async functions/methods" },
          isStatic: { type: "boolean", description: "Only static methods" },
          isAbstract: { type: "boolean", description: "Only abstract classes/methods" },
          minComplexity: { type: "number", description: "Minimum cyclomatic complexity" },
          maxComplexity: { type: "number", description: "Maximum cyclomatic complexity" },
          minScore: { type: "number", description: "Minimum relevance score 0-1" },
          hasDocumentation: { type: "boolean", description: "Require documentation" },
          language: {
            type: "string",
            enum: [...caps.languages],
            description: "Filter by programming language",
          },
          parentScope: { type: "string", description: "Parent scope/class name" },
          imports: { type: "string", description: "Filter by imported module name" },
          semanticKind: {
            type: "string",
            enum: caps.semanticKinds.map((kind: any) => kind.name),
            description: "Framework-aware kind (convexMutation, convexAction, reactComponent, reactHook, routeHandler, etc.)",
          },
          explainFilters: { type: "boolean", description: "Include deterministic filter match explanations in JSON results" },
          strictParent: { type: "boolean", description: "Require strict parent metadata when filtering by parent" },
          strictImports: { type: "boolean", description: "Require strict import metadata when filtering by imports" },
          shake: { type: "boolean", description: "Enable tree-shaken representative snippets" },
          rootDir: { type: "string", description: "Root directory (default: cwd)" },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.cluster,
      description: "Semantic code clustering. Breaks a broad query into coherent subthemes using embeddings + AST metadata and returns representative snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language theme query to decompose into clusters" },
          pattern: { type: "string", description: "Optional regex pattern filter" },
          limit: { type: "number", description: "Max clusters to return (default: 5)" },
          rawLimit: { type: "number", description: "Raw matches to gather before clustering (default: 70)" },
          perCluster: { type: "number", description: "Representative snippets per cluster (default: 2)" },
          clusterThreshold: { type: "number", description: "Similarity threshold for linking matches (default: 0.72)" },
          minClusterSize: { type: "number", description: "Minimum cluster size before singleton fallback (default: 2)" },
          include: { type: "string", description: "File glob include filter (e.g., 'src/**/*.ts')" },
          exclude: { type: "string", description: "File glob exclude filter (e.g., '*.md' or 'docs/**')" },
          symbol: { type: "string", description: "Filter by symbol name" },
          name: { type: "string", description: "Alias for symbol name" },
          symbolType: {
            type: "string",
            enum: [...caps.symbolTypes],
            description: "Semantic symbol type",
          },
          variant: {
            type: "string",
            description: `Language-specific variant. Available: ${variantDesc}...`,
          },
          decorator: {
            type: "string",
            description: `Filter by decorator (${caps.decorators.slice(0, 5).join(", ")}...)`,
          },
          isExported: { type: "boolean", description: "Only exported symbols" },
          isAsync: { type: "boolean", description: "Only async functions/methods" },
          isStatic: { type: "boolean", description: "Only static methods" },
          isAbstract: { type: "boolean", description: "Only abstract classes/methods" },
          minComplexity: { type: "number", description: "Minimum cyclomatic complexity" },
          maxComplexity: { type: "number", description: "Maximum cyclomatic complexity" },
          minScore: { type: "number", description: "Minimum relevance score 0-1" },
          hasDocumentation: { type: "boolean", description: "Require documentation" },
          language: {
            type: "string",
            enum: [...caps.languages],
            description: "Filter by programming language",
          },
          parentScope: { type: "string", description: "Parent scope/class name" },
          imports: { type: "string", description: "Filter by imported module name" },
          semanticKind: {
            type: "string",
            enum: caps.semanticKinds.map((kind: any) => kind.name),
            description: "Framework-aware kind (convexMutation, convexAction, reactComponent, reactHook, routeHandler, etc.)",
          },
          explainFilters: { type: "boolean", description: "Include deterministic filter match explanations in JSON results" },
          strictParent: { type: "boolean", description: "Require strict parent metadata when filtering by parent" },
          strictImports: { type: "boolean", description: "Require strict import metadata when filtering by imports" },
          shake: { type: "boolean", description: "Enable tree-shaken representative snippets" },
          rootDir: { type: "string", description: "Root directory (default: cwd)" },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.detectDuplicates,
      description: "Detect logical duplicates using the existing semantic index.",
      inputSchema: toInputSchema(DuplicateToolArgsSchema) as Tool["inputSchema"],
    },
    {
      name: TOOL_NAMES.index,
      description: "Create/update semantic index or fetch index stats for the given root directory.",
      inputSchema: toInputSchema(IndexToolArgsSchema) as Tool["inputSchema"],
    },
    {
      name: TOOL_NAMES.graph,
      description: "Find symbol references, calculate transitive change impact, or trace a reference path.",
      inputSchema: toInputSchema(GraphToolArgsSchema) as Tool["inputSchema"],
    },
  ];

  cachedTools[0].inputSchema = toRootedInputSchema(core.SenseGrepParametersSchema) as Tool["inputSchema"];
  cachedTools[1].inputSchema = toRootedInputSchema(core.SurveyParametersSchema) as Tool["inputSchema"];
  cachedTools[2].inputSchema = toRootedInputSchema(core.ClusterParametersSchema) as Tool["inputSchema"];
  cachedTools.splice(1, 0, {
    name: TOOL_NAMES.context,
    description: "Build a diversified, tree-shaken context pack constrained by a token budget.",
    inputSchema: toRootedInputSchema(core.SenseGrepContextParametersSchema) as Tool["inputSchema"],
  });
  cachedTools.splice(1, 0, {
    name: TOOL_NAMES.show,
    description: "Expand a compact search result by resultId, optionally with graph evidence.",
    inputSchema: toRootedInputSchema(core.SenseGrepShowParametersSchema) as Tool["inputSchema"],
  });
  cachedTools.splice(1, 0, {
    name: TOOL_NAMES.literal,
    description: "Exhaustive deterministic literal or regex search without embedding calls.",
    inputSchema: toRootedInputSchema(core.SenseGrepLiteralParametersSchema) as Tool["inputSchema"],
  });

  return cachedTools;
}

const server = new Server(
  {
    name: "sensegrep",
    version: "1.10.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await generateTools();
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request, requestContext) => {
  const { name } = request.params;
  const args = ((request.params.arguments ?? {}) as Record<string, unknown>) as any;
  const rootDirArg = args.rootDir;
  const rootDir =
    typeof rootDirArg === "string" && rootDirArg.length > 0
      ? rootDirArg
      : process.env.SENSEGREP_ROOT || process.cwd();
  const profile = typeof args.profile === "string" ? args.profile : undefined;

  try {
    if (matchesToolName(name, TOOL_NAMES.show, "sensegrep.show")) {
      const { core, tool } = await loadShowTool();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const res = await core.Instance.provide({
        directory: rootDir,
        profile,
        fn: () => tool.execute(toolArgs, {
          sessionID: "mcp", messageID: "mcp", agent: "sensegrep-mcp", abort: requestContext.signal,
          metadata(_input: unknown) {},
        }),
      });
      const { output: _output, ...structuredContent } = res;
      return { content: [{ type: "text", text: res.output }], structuredContent };
    }

    if (matchesToolName(name, TOOL_NAMES.literal, "sensegrep.literal")) {
      const core = await loadCore();
      const tool = await core.SenseGrepLiteralTool.init();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const res = await core.Instance.provide({
        directory: rootDir,
        profile,
        fn: () => tool.execute(toolArgs, {
          sessionID: "mcp",
          messageID: "mcp",
          agent: "sensegrep-mcp",
          abort: requestContext.signal,
          metadata(_input: unknown) {},
        }),
      });
      const { output: _output, ...structuredContent } = res;
      return { content: [{ type: "text", text: res.output }], structuredContent };
    }

    if (matchesToolName(name, TOOL_NAMES.context, "sensegrep.context")) {
      const { core, tool } = await loadContextTool();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const { Instance } = core;
      const res = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () => tool.execute(toolArgs, {
          sessionID: "mcp",
          messageID: "mcp",
          agent: "sensegrep-mcp",
          abort: requestContext.signal,
          metadata(_input: unknown) {},
        }),
      });
      const { output: _output, ...structuredContent } = res;
      return { content: [{ type: "text", text: res.output }], structuredContent };
    }

    if (matchesToolName(name, TOOL_NAMES.search, "sensegrep.search")) {
      const { core, tool } = await loadTool();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const { Instance } = core;
      // Search tool now reads embeddings config from index automatically
      const res = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () =>
          tool.execute(toolArgs, {
            sessionID: "mcp",
            messageID: "mcp",
            agent: "sensegrep-mcp",
            abort: requestContext.signal,
            metadata(_input: { title?: string; metadata?: unknown }) {},
          }),
      });
      const detail = toolArgs.resultDetail ?? "compact";
      const structuredContent = detail === "full" ? res : detail === "content" ? (({ output: _output, ...rest }) => rest)(res) : compactSearchResponse(res);
      const text = detail === "compact"
        ? JSON.stringify({ status: res.status, retrieval: res.retrieval, results: structuredContent.results, warnings: res.warnings })
        : res.output;
      return { content: [{ type: "text", text }], structuredContent };
    }

    if (matchesToolName(name, TOOL_NAMES.survey, "sensegrep.survey")) {
      const { core, tool } = await loadSurveyTool();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const { Instance } = core;
      const res = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () =>
          tool.execute(toolArgs, {
            sessionID: "mcp",
            messageID: "mcp",
            agent: "sensegrep-mcp",
            abort: requestContext.signal,
            metadata(_input: { title?: string; metadata?: unknown }) {},
          }),
      });
      const { output: _output, ...compact } = res;
      return {
        content: [{ type: "text", text: res.output }],
        structuredContent: toolArgs.jsonDetail === "full" ? { ...res, output: res.output } : compact,
      };
    }

    if (matchesToolName(name, TOOL_NAMES.cluster, "sensegrep.cluster")) {
      const { core, tool } = await loadClusterTool();
      const { rootDir: _root, profile: _profile, ...toolArgs } = args as any;
      const { Instance } = core;
      const res = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () =>
          tool.execute(toolArgs, {
            sessionID: "mcp",
            messageID: "mcp",
            agent: "sensegrep-mcp",
            abort: requestContext.signal,
            metadata(_input: { title?: string; metadata?: unknown }) {},
          }),
      });
      const { output: _output, ...compact } = res;
      return {
        content: [{ type: "text", text: res.output }],
        structuredContent: toolArgs.jsonDetail === "full" ? { ...res, output: res.output } : compact,
      };
    }

    const isLegacyStatsTool = matchesToolName(name, "sensegrep_stats", "sensegrep.stats");
    if (matchesToolName(name, TOOL_NAMES.index, "sensegrep.index") || isLegacyStatsTool) {
      const { core } = await loadTool();
      const { Indexer, Instance } = core;
      const indexArgs = IndexToolArgsSchema.parse({
        ...args,
        action: args.action ?? (isLegacyStatsTool ? "stats" : "index"),
      });
      const action = indexArgs.action;

      if (action === "stats") {
        const stats = await Instance.provide({
          directory: rootDir,
          profile,
          fn: () => Indexer.getStats(),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
          structuredContent: {
            action: "stats",
            rootDir,
            stats,
          },
        };
      }

      if (action === "plan") {
        const plan = await Instance.provide({
          directory: rootDir,
          profile,
          fn: () => Indexer.planIndex({ full: indexArgs.mode === "full", signal: requestContext.signal }),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: { action: "plan", rootDir, plan },
        };
      }

      const mode = indexArgs.mode;
      const full = mode === "full";
      const result = (await Instance.provide({
        directory: rootDir,
        profile,
        fn: () => (full
          ? Indexer.indexProject({ signal: requestContext.signal })
          : Indexer.indexProjectIncremental({ signal: requestContext.signal })),
      })) as any;
      const stats = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () => Indexer.getStats(),
      });
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
        content: [{ type: "text", text: `${text}\n\nStats:\n${JSON.stringify(stats, null, 2)}` }],
        structuredContent: {
          action: "index",
          mode,
          rootDir,
          result,
          stats,
          summary: text,
        },
      };
    }

    if (matchesToolName(name, TOOL_NAMES.graph, "sensegrep.graph")) {
      const { CodeGraph, Instance } = await loadCore();
      const graphArgs = GraphToolArgsSchema.parse(args);
      const result = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () => graphArgs.action === "references"
          ? CodeGraph.findReferences(graphArgs.symbol ?? graphArgs.id!.split(":").at(-1)!, graphArgs)
          : graphArgs.action === "impact"
            ? CodeGraph.impact(graphArgs.symbol ?? graphArgs.id!.split(":").at(-1)!, graphArgs)
            : CodeGraph.trace(graphArgs.from ?? graphArgs.fromId!.split(":").at(-1)!, graphArgs.to ?? graphArgs.toId!.split(":").at(-1)!, graphArgs),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { action: graphArgs.action, rootDir, result },
      };
    }

    if (
      matchesToolName(
        name,
        TOOL_NAMES.detectDuplicates,
        "sensegrep.detect_duplicates",
        "sensegrep.detect-duplicates",
      )
    ) {
      const { core } = await loadTool();
      const { DuplicateDetector, Instance } = core;
      const duplicateArgs = DuplicateToolArgsSchema.parse(args);
      const minThreshold = duplicateArgs.threshold;

      let scopeFilter: Array<"function" | "method"> | undefined;
      const scopeRaw = duplicateArgs.scope;
      if (scopeRaw) {
        const scopeStr = String(scopeRaw).toLowerCase();
        if (scopeStr === "all") {
          scopeFilter = [];
        } else if (scopeStr === "function") {
          scopeFilter = ["function"];
        } else if (scopeStr === "method") {
          scopeFilter = ["method"];
        } else {
          scopeFilter = scopeStr.split(",").map((s) => s.trim()) as any;
        }
      } else {
        scopeFilter = ["function", "method"];
      }

      const options = {
        path: rootDir,
        thresholds: {
          exact: 0.98,
          high: 0.9,
          medium: 0.85,
          low: minThreshold,
        },
        scopeFilter,
        ignoreTests: duplicateArgs.ignoreTests,
        crossFileOnly: duplicateArgs.crossFileOnly,
        crossLanguage: duplicateArgs.crossLanguage,
        language: duplicateArgs.language,
        onlyExported: duplicateArgs.onlyExported,
        excludePattern: duplicateArgs.excludePattern,
        minLines: duplicateArgs.minLines,
        minComplexity: duplicateArgs.minComplexity,
        maxCandidates: duplicateArgs.maxCandidates,
        maxTokens: duplicateArgs.maxTokens,
        timeoutMs: duplicateArgs.timeoutMs,
        resumeCursor: duplicateArgs.resumeCursor,
        include: duplicateArgs.include,
        exclude: duplicateArgs.exclude,
        ignoreAcceptablePatterns: duplicateArgs.ignoreAcceptablePatterns,
        normalizeIdentifiers: duplicateArgs.normalizeIdentifiers,
        rankByImpact: duplicateArgs.rankByImpact,
      };

      const showCode = duplicateArgs.showCode;
      const verbose = duplicateArgs.verbose;
      const quiet = duplicateArgs.quiet;
      const limit = duplicateArgs.limit;

      const result = await Instance.provide({
        directory: rootDir,
        profile,
        fn: () => DuplicateDetector.detect(options),
      });

      if (duplicateArgs.json) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }

      const lines: string[] = [];
      if (!quiet) {
        lines.push("Detecting logical duplicates...");
        lines.push(`Path: ${rootDir}`);
        lines.push(`Threshold: ${minThreshold}`);
        lines.push(`Scope: ${scopeFilter?.join(", ") || "all"}`);
        if (options.crossFileOnly) lines.push("Filter: cross-file only");
        if (options.onlyExported) lines.push("Filter: exported only");
        if (options.include) lines.push(`Filter: include ${options.include}`);
        if (options.exclude) lines.push(`Filter: exclude ${options.exclude}`);
        if (options.excludePattern) lines.push(`Filter: exclude pattern /${options.excludePattern}/`);
        lines.push("");
        lines.push("━".repeat(80));
        lines.push("DUPLICATE DETECTION RESULTS");
        lines.push("━".repeat(80));
        lines.push(`Total duplicates: ${result.summary.totalDuplicates}`);
        const formatPct = (value: number) => (value * 100).toFixed(1);
        const thresholds = options.thresholds;
        const critical = result.duplicates.filter((d: any) => d.similarity >= thresholds.exact).length;
        const high = result.duplicates.filter(
          (d: any) => d.similarity >= thresholds.high && d.similarity < thresholds.exact,
        ).length;
        const medium = result.duplicates.filter(
          (d: any) => d.similarity >= thresholds.medium && d.similarity < thresholds.high,
        ).length;
        const low = result.duplicates.filter(
          (d: any) => d.similarity >= thresholds.low && d.similarity < thresholds.medium,
        ).length;
        if (critical > 0) {
          lines.push(
            `  🔥 Critical (≥${formatPct(thresholds.exact)}%): ${critical}  ← Exact duplicates, refactor NOW`,
          );
        }
        if (high > 0) {
          lines.push(
            `  ⚠️  High (${formatPct(thresholds.high)}–${formatPct(thresholds.exact)}%): ${high}   ← Very similar, should review`,
          );
        }
        if (medium > 0) {
          lines.push(
            `  ℹ️  Medium (${formatPct(thresholds.medium)}–${formatPct(thresholds.high)}%): ${medium} ← Similar, investigate`,
          );
        }
        if (low > 0) {
          lines.push(
            `  💡 Low (${formatPct(thresholds.low)}–${formatPct(thresholds.medium)}%): ${low}   ← Somewhat similar`,
          );
        }
        lines.push("");
        lines.push(`Files affected: ${result.summary.filesAffected}`);
        lines.push(`Potential savings: ${result.summary.totalSavings} lines`);
        lines.push("");
      }

      if (result.duplicates.length === 0) {
        lines.push("✅ No significant duplicates found!");
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            rootDir,
            summary: result.summary,
            duplicates: [],
          },
        };
      }

      if (quiet) {
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            rootDir,
            summary: result.summary,
            duplicates: result.duplicates.slice(0, limit),
          },
        };
      }

      const topDuplicates = result.duplicates.slice(0, limit);
      lines.push(`Top ${topDuplicates.length} duplicates (ranked by impact):`);
      lines.push("");

      for (let i = 0; i < topDuplicates.length; i++) {
        const dup = topDuplicates[i];
        const similarity = dup.similarity ?? 0;
        const level = dup.level ?? "";
        let emoji = "💡";
        let label = "LOW";
        if (similarity >= options.thresholds.exact || level === "exact") {
          emoji = "🔥";
          label = "CRITICAL";
        } else if (level === "high") {
          emoji = "⚠️ ";
          label = "HIGH";
        } else if (level === "medium") {
          emoji = "ℹ️ ";
          label = "MEDIUM";
        }

        lines.push(`${emoji} #${i + 1} - ${label} (${(similarity * 100).toFixed(1)}% similar)`);
        if (verbose) {
          lines.push(
            `   Impact: ${dup.impact.totalLines} lines × ${dup.impact.complexity.toFixed(1)} complexity × ${dup.impact.fileCount} files = ${dup.impact.score.toFixed(0)} score`,
          );
          lines.push(`   Potential savings: ${dup.impact.estimatedSavings} lines`);
        }
        for (const inst of dup.instances) {
          const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "");
          const linesCount = inst.endLine - inst.startLine + 1;
          lines.push(`   ${relPath}:${inst.startLine}-${inst.endLine} (${inst.symbol}, ${linesCount} lines)`);
        }

        if (showCode || verbose) {
          lines.push("");
          for (let j = 0; j < dup.instances.length; j++) {
            const inst = dup.instances[j];
            const relPath = inst.file.replace(rootDir, "").replace(/^[/\\]/, "");
            lines.push(`   ┌─ ${String.fromCharCode(65 + j)}: ${relPath}:${inst.startLine}`);
            const codeLines = String(inst.content ?? "").split("\n");
            const maxLines = showCode && !verbose ? 15 : 30;
            const displayLines = codeLines.slice(0, maxLines);
            for (const line of displayLines) {
              lines.push(`   │ ${line}`);
            }
            if (codeLines.length > maxLines) {
              lines.push(`   │ ... (${codeLines.length - maxLines} more lines)`);
            }
            lines.push("   └─");
          }
        }

        lines.push("");
      }

      if (result.duplicates.length > limit) {
        lines.push(`... and ${result.duplicates.length - limit} more duplicates`);
        lines.push(`Use --limit ${result.duplicates.length} to see all`);
        lines.push("");
      }

      if (result.acceptableDuplicates && result.acceptableDuplicates.length > 0) {
        lines.push(
          `💡 ${result.acceptableDuplicates.length} acceptable duplicates ignored (simple validations, guards, etc.)`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          rootDir,
          summary: result.summary,
          duplicates: result.duplicates.slice(0, limit),
        },
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    const message = error?.message || "Internal error";
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      structuredContent: {
        error: message,
      },
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
