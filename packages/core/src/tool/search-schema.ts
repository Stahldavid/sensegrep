import z from "zod"

export const SymbolTypeSchema = z.enum(["function", "class", "method", "type", "variable", "enum", "module"])
export const BuiltinLanguageSchema = z.enum(["typescript", "javascript", "python", "java", "vue"])
export const FileRoleSchema = z.enum(["implementation", "test", "generated", "contract", "configuration", "documentation", "migration", "fixture", "build-artifact"])

export const CommonSearchShape = {
  query: z.string().trim().min(1).describe("Natural-language query or code snippet"),
  pattern: z.string().optional().describe("Optional regular-expression post-filter"),
  include: z.string().optional().describe("File glob include filter"),
  exclude: z.string().optional().describe("File glob exclude filter"),
  minScore: z.number().min(0).max(1).optional().describe("Minimum relevance score 0-1"),
  symbol: z.string().optional().describe("Filter by symbol name"),
  name: z.string().optional().describe("Alias for symbol"),
  exact: z.boolean().optional().describe("Prefer exact symbol-name lookup"),
  hybrid: z.boolean().default(true).describe("Fuse vector and lexical retrieval"),
  hybridMode: z.enum(["adaptive", "parallel"]).optional().describe("Adaptive (default) may skip lexical retrieval when semantic evidence is already strong"),
  rerank: z.boolean().default(false).describe("Apply deterministic second-stage reranking"),
  symbolType: SymbolTypeSchema.optional().describe("Filter by semantic symbol type"),
  variant: z.string().optional().describe("Filter by language-specific variant"),
  decorator: z.string().optional().describe("Filter by decorator"),
  isExported: z.boolean().optional().describe("Only exported/public symbols"),
  isAsync: z.boolean().optional().describe("Only async functions/methods"),
  isStatic: z.boolean().optional().describe("Only static methods"),
  isAbstract: z.boolean().optional().describe("Only abstract classes/methods"),
  minComplexity: z.number().nonnegative().optional().describe("Minimum cyclomatic complexity"),
  maxComplexity: z.number().nonnegative().optional().describe("Maximum cyclomatic complexity"),
  hasDocumentation: z.boolean().optional().describe("Require documentation"),
  language: z.string().min(1).optional().describe("Filter by registered language id"),
  parentScope: z.string().optional().describe("Filter by parent scope/class"),
  imports: z.string().optional().describe("Filter by imported module name"),
  semanticKind: z.string().optional().describe("Filter by framework-aware semantic kind"),
  explainFilters: z.boolean().optional().describe("Include filter and ranking explanations"),
  strictParent: z.boolean().optional().describe("Require strict parent metadata"),
  strictImports: z.boolean().optional().describe("Require strict import metadata"),
  shake: z.boolean().default(true).describe("Enable semantic tree-shaking"),
  maxTokens: z.number().int().positive().max(1_000_000).optional().describe("Maximum estimated output tokens"),
  gitChanged: z.boolean().optional().describe("Restrict results to Git-changed files"),
  gitBase: z.string().optional().describe("Git base revision used by gitChanged"),
  embeddingTimeoutMs: z.number().int().positive().max(300_000).optional().describe("Deadline for obtaining the query embedding"),
  latencyBudgetMs: z.number().int().positive().max(300_000).optional().describe("Deprecated alias for embeddingTimeoutMs"),
  purpose: z.enum(["understand", "implement", "review", "test"]).optional().describe("Ranking preset for the task (default: understand)"),
  preferRole: FileRoleSchema.optional().describe("Boost one file role"),
  includeRole: FileRoleSchema.optional().describe("Only include one file role"),
  excludeRole: FileRoleSchema.optional().describe("Exclude one file role"),
  resultDetail: z.enum(["minimal", "compact", "content", "diagnostic", "full"]).optional().describe("Structured result projection (compact aliases minimal)"),
  commandName: z.enum(["search", "context", "audit"]).optional().describe("Internal result envelope command name"),
} as const

export const SenseGrepParametersSchema = z.object({
  ...CommonSearchShape,
  limit: z.number().int().positive().max(500).optional().describe("Maximum results (default: 10)"),
  maxPerFile: z.number().int().nonnegative().optional().describe("Maximum results per file (default: 2)"),
  maxPerSymbol: z.number().int().nonnegative().optional().describe("Maximum results per symbol (default: 2)"),
})

export type SenseGrepParameters = z.infer<typeof SenseGrepParametersSchema>
