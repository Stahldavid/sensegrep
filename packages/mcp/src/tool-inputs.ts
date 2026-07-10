import z from "zod"

const RootDir = z.string().min(1).optional().describe("Root directory (default: cwd)")

export const IndexToolArgsSchema = z.object({
  action: z.enum(["index", "stats"]).default("index").describe("Operation type"),
  rootDir: RootDir,
  mode: z.enum(["incremental", "full"]).default("incremental").describe("Index mode"),
}).strict()

const DuplicateScope = z.string()
  .refine((value) => {
    const values = value.toLowerCase().split(",").map((entry) => entry.trim())
    const hasOnlyKnownValues = values.length > 0
      && values.every((entry) => entry === "function" || entry === "method" || entry === "all")
    return hasOnlyKnownValues && (!values.includes("all") || values.length === 1)
  }, "scope must be all, function, method, or function,method")

export const DuplicateToolArgsSchema = z.object({
  rootDir: RootDir,
  threshold: z.number().min(0).max(1).default(0.85),
  scope: DuplicateScope.optional(),
  language: z.string().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
  crossLanguage: z.boolean().default(false),
  ignoreTests: z.boolean().default(false),
  crossFileOnly: z.boolean().default(false),
  onlyExported: z.boolean().default(false),
  excludePattern: z.string().optional(),
  minLines: z.number().int().nonnegative().default(10),
  minComplexity: z.number().nonnegative().default(0),
  maxCandidates: z.number().int().positive().optional(),
  ignoreAcceptablePatterns: z.boolean().default(false),
  normalizeIdentifiers: z.boolean().default(true),
  rankByImpact: z.boolean().default(true),
  limit: z.number().int().positive().default(10),
  showCode: z.boolean().default(false),
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
  json: z.boolean().default(false),
}).strict()

export function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>
}
