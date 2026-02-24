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
let cachedTools: Tool[] | null = null;
const WATCH_INTERVAL_MS = 60_000;
let watchHandle: { stop: () => Promise<void> } | null = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOL_NAMES = {
  search: "sensegrep_search",
  detectDuplicates: "sensegrep_detect_duplicates",
  index: "sensegrep_index",
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
          include: { type: "string", description: "File glob filter (e.g., 'src/**/*.ts')" },
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
          rerank: { type: "boolean", description: "Enable cross-encoder reranking" },
          rootDir: { type: "string", description: "Root directory (default: cwd)" },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.detectDuplicates,
      description: "Detect logical duplicates using the existing semantic index.",
      inputSchema: {
        type: "object",
        properties: {
          rootDir: { type: "string", description: "Root directory (default: cwd)" },
          threshold: { type: "number", description: "Minimum similarity 0.0-1.0 (default: 0.85)" },
          scope: { type: "string", description: "Scope: function, method, all (or comma-separated)" },
          language: { type: "string", description: "Filter by language (comma-separated)" },
          crossLanguage: { type: "boolean", description: "Detect duplicates across languages (default: off)" },
          ignoreTests: { type: "boolean", description: "Ignore test files" },
          crossFileOnly: { type: "boolean", description: "Only report cross-file duplicates" },
          onlyExported: { type: "boolean", description: "Only exported symbols" },
          excludePattern: { type: "string", description: "Exclude symbols matching regex" },
          minLines: { type: "number", description: "Minimum lines (default: 10)" },
          minComplexity: { type: "number", description: "Minimum complexity (default: 0)" },
          ignoreAcceptablePatterns: { type: "boolean", description: "Do not ignore acceptable duplicates" },
          normalizeIdentifiers: { type: "boolean", description: "Normalize identifiers (default: true)" },
          rankByImpact: { type: "boolean", description: "Rank by impact (default: true)" },
          limit: { type: "number", description: "Max duplicates to show (default: 10)" },
          showCode: { type: "boolean", description: "Show code snippets" },
          verbose: { type: "boolean", description: "Show detailed output" },
          quiet: { type: "boolean", description: "Only show summary" },
          json: { type: "boolean", description: "Return raw JSON result" },
        },
      },
    },
    {
      name: TOOL_NAMES.index,
      description: "Create/update semantic index or fetch index stats for the given root directory.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["index", "stats"],
            description: "Operation type: index (default) or stats",
          },
          rootDir: { type: "string", description: "Root directory to index" },
          mode: {
            type: "string",
            enum: ["incremental", "full"],
            description: "Index mode when action=index (default: incremental)",
          },
        },
      },
    },
  ];

  return cachedTools;
}

const server = new Server(
  {
    name: "sensegrep",
    version: "0.1.22",
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = ((request.params.arguments ?? {}) as Record<string, unknown>) as any;
  const rootDirArg = args.rootDir;
  const rootDir =
    typeof rootDirArg === "string" && rootDirArg.length > 0
      ? rootDirArg
      : process.env.SENSEGREP_ROOT || process.cwd();

  try {
    if (matchesToolName(name, TOOL_NAMES.search, "sensegrep.search")) {
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
        structuredContent: {
          output: res.output,
        },
      };
    }

    const isLegacyStatsTool = matchesToolName(name, "sensegrep_stats", "sensegrep.stats");
    if (matchesToolName(name, TOOL_NAMES.index, "sensegrep.index") || isLegacyStatsTool) {
      const { core } = await loadTool();
      const { Indexer, Instance } = core;
      const action = String(
        (args as any).action ?? (isLegacyStatsTool ? "stats" : "index"),
      ).toLowerCase();

      if (action !== "index" && action !== "stats") {
        throw new Error(`Invalid action: ${action}. Expected "index" or "stats".`);
      }

      if (action === "stats") {
        const stats = await Instance.provide({
          directory: rootDir,
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

      const mode = String((args as any).mode ?? "incremental").toLowerCase();
      const full = mode === "full";
      const result = (await Instance.provide({
        directory: rootDir,
        fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
      })) as any;
      const stats = await Instance.provide({
        directory: rootDir,
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
      const minThreshold =
        typeof (args as any)?.threshold === "number" ? Number((args as any).threshold) : 0.85;

      let scopeFilter: Array<"function" | "method"> | undefined;
      const scopeRaw = (args as any)?.scope;
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

      const normalizeIdentifiers =
        typeof (args as any)?.normalizeIdentifiers === "boolean"
          ? Boolean((args as any).normalizeIdentifiers)
          : true;
      const rankByImpact =
        typeof (args as any)?.rankByImpact === "boolean" ? Boolean((args as any).rankByImpact) : true;

      const options = {
        path: rootDir,
        thresholds: {
          exact: 0.98,
          high: 0.9,
          medium: 0.85,
          low: minThreshold,
        },
        scopeFilter,
        ignoreTests: Boolean((args as any)?.ignoreTests),
        crossFileOnly: Boolean((args as any)?.crossFileOnly),
        onlyExported: Boolean((args as any)?.onlyExported),
        excludePattern: (args as any)?.excludePattern ? String((args as any).excludePattern) : undefined,
        minLines: typeof (args as any)?.minLines === "number" ? Number((args as any).minLines) : 10,
        minComplexity:
          typeof (args as any)?.minComplexity === "number" ? Number((args as any).minComplexity) : 0,
        ignoreAcceptablePatterns: Boolean((args as any)?.ignoreAcceptablePatterns),
        normalizeIdentifiers,
        rankByImpact,
      };

      const showCode = Boolean((args as any)?.showCode);
      const verbose = Boolean((args as any)?.verbose);
      const quiet = Boolean((args as any)?.quiet);
      const limit = typeof (args as any)?.limit === "number" ? Number((args as any).limit) : 10;

      const result = await Instance.provide({
        directory: rootDir,
        fn: () => DuplicateDetector.detect(options),
      });

      if ((args as any)?.json) {
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
