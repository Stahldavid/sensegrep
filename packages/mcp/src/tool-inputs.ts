import z from "zod"

const RootDir = z.string().min(1).optional().describe("Root directory (default: cwd)")
const Profile = z.string().regex(/^[A-Za-z0-9._-]+$/).optional().describe("Named side-by-side index profile")

export const IndexToolArgsSchema = z.object({
  action: z.enum(["index", "stats", "plan"]).default("index").describe("Operation type"),
  rootDir: RootDir,
  profile: Profile,
  mode: z.enum(["incremental", "full"]).default("incremental").describe("Index mode"),
}).strict()

export const GraphToolArgsSchema = z.object({
  action: z.enum(["references", "impact", "trace"]),
  rootDir: RootDir,
  profile: Profile,
  symbol: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  fromId: z.string().min(1).optional(),
  toId: z.string().min(1).optional(),
  depth: z.number().int().positive().max(20).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  maxDocuments: z.number().int().positive().max(1_000_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action !== "trace" && !value.symbol && !value.id) {
    context.addIssue({ code: "custom", path: ["symbol"], message: "symbol is required" })
  }
  if (value.action === "trace" && ((!value.from && !value.fromId) || (!value.to && !value.toId))) {
    context.addIssue({ code: "custom", path: ["from"], message: "from and to are required for trace" })
  }
})

const DuplicateScope = z.string()
  .refine((value) => {
    const values = value.toLowerCase().split(",").map((entry) => entry.trim())
    const hasOnlyKnownValues = values.length > 0
      && values.every((entry) => entry === "function" || entry === "method" || entry === "all")
    return hasOnlyKnownValues && (!values.includes("all") || values.length === 1)
  }, "scope must be all, function, method, or function,method")

export const DuplicateToolArgsSchema = z.object({
  rootDir: RootDir,
  profile: Profile,
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
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  resumeCursor: z.number().int().nonnegative().optional(),
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

export function toRootedInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = toInputSchema(schema)
  return {
    ...json,
    properties: {
      ...((json.properties as Record<string, unknown> | undefined) ?? {}),
      rootDir: { type: "string", minLength: 1, description: "Project root directory (default: cwd)" },
      profile: { type: "string", minLength: 1, description: "Optional named index profile" },
    },
  }
}
