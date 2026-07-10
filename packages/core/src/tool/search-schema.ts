import z from "zod"

export const SymbolTypeSchema = z.enum(["function", "class", "method", "type", "variable", "enum", "module"])
export const BuiltinLanguageSchema = z.enum(["typescript", "javascript", "python", "java", "vue"])

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
} as const

export const SenseGrepParametersSchema = z.object({
  ...CommonSearchShape,
  limit: z.number().int().positive().max(500).optional().describe("Maximum results (default: 10)"),
  maxPerFile: z.number().int().nonnegative().optional().describe("Maximum results per file (default: 2)"),
  maxPerSymbol: z.number().int().nonnegative().optional().describe("Maximum results per symbol (default: 2)"),
})

export type SenseGrepParameters = z.infer<typeof SenseGrepParametersSchema>
