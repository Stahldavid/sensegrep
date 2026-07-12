import * as lancedb from "@lancedb/lancedb"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "node:fs"
import crypto from "node:crypto"
import z from "zod"

import { Log } from "../util/log.js"
import { Global } from "../global/index.js"
import { Embeddings } from "./embeddings.js"
import { Instance } from "../project/instance.js"

const log = Log.create({ service: "semantic.lancedb" })

type LanceDBConnection = Awaited<ReturnType<typeof lancedb.connect>>
type LanceTable = Awaited<ReturnType<LanceDBConnection["openTable"]>>

/** Collapsible region for tree-shaking (pre-computed during indexing) */
export interface CollapsibleRegion {
  type: "method" | "function" | "constructor" | "arrow_function"
  name: string
  startLine: number
  endLine: number
  signatureEndLine: number
  indentation: string
}

export namespace VectorStore {
  const BASE_PATH = path.join(Global.Path.data, ".lancedb")
  const TABLE_NAME = "chunks"
  export type DistanceMetric = "cosine" | "l2" | "dot"
  export const DEFAULT_DISTANCE_METRIC: DistanceMetric = "cosine"

  export type IndexMeta = {
    version: number
    root: string
    profile?: string
    tableName?: string
    embeddings: {
      provider: string
      model?: string
      dimension: number
      device?: string
      distanceMetric?: DistanceMetric
      configFingerprint?: string
    }
    chunking?: {
      version: number
      provider: string
      model: string
      dimension: number
      maxInputTokens?: number
      modelMaxTokens: number
      usableModelTokens: number
      maxChars: number
      minChars: number
      overlapChars: number
      simpleChars: number
      mediumChars: number
      complexChars: number
    }
    files: Record<string, {
      size: number
      mtimeMs: number
      hash?: string
      chunks?: string[]
      /** Pre-computed collapsible regions for tree-shaking */
      collapsibleRegions?: CollapsibleRegion[]
    }>
    updatedAt: number
  }

  const CollapsibleRegionSchema = z.object({
    type: z.enum(["method", "function", "constructor", "arrow_function"]),
    name: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    signatureEndLine: z.number(),
    indentation: z.string(),
  })

  const IndexMetaSchema = z.object({
    version: z.number(),
    root: z.string().min(1),
    profile: z.string().min(1).optional(),
    tableName: z.string().min(1).optional(),
    embeddings: z.object({
      provider: z.string().min(1),
      model: z.string().optional(),
      dimension: z.number().int().positive(),
      device: z.string().optional(),
      distanceMetric: z.enum(["cosine", "l2", "dot"]).optional(),
      configFingerprint: z.string().optional(),
    }),
    chunking: z.object({
      version: z.number(),
      provider: z.string(),
      model: z.string(),
      dimension: z.number(),
      maxInputTokens: z.number().optional(),
      modelMaxTokens: z.number(),
      usableModelTokens: z.number(),
      maxChars: z.number(),
      minChars: z.number(),
      overlapChars: z.number(),
      simpleChars: z.number(),
      mediumChars: z.number(),
      complexChars: z.number(),
    }).optional(),
    files: z.record(z.string(), z.object({
      size: z.number(),
      mtimeMs: z.number(),
      hash: z.string().optional(),
      chunks: z.array(z.string()).optional(),
      collapsibleRegions: z.array(CollapsibleRegionSchema).optional(),
    })),
    updatedAt: z.number(),
  })

  // Filter operators for structured queries
  export type FilterOperator =
    | "equals"
    | "not_equals"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "greater_than"
    | "less_than"
    | "greater_or_equal"
    | "less_or_equal"
    | "in"
    | "not_in"

  // Single filter condition
  export interface Filter {
    key: string
    operator: FilterOperator
    value: string | number | boolean | string[] | number[]
  }

  // Structured filters with logical operators
  export interface SearchFilters {
    all?: Filter[] // AND logic - all conditions must match
    any?: Filter[] // OR logic - at least one condition must match
    none?: Filter[] // NOT logic - none of the conditions must match
  }

  function getLegacyProjectHash(projectPath: string): string {
    let hash = 0
    for (let i = 0; i < projectPath.length; i++) {
      hash = (hash << 5) - hash + projectPath.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }

  function getProjectHash(projectPath: string): string {
    const resolved = path.resolve(projectPath)
    const canonical = process.platform === "win32" ? resolved.toLowerCase() : resolved
    return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 24)
  }

  function projectDir(projectPath: string): string {
    const profile = Instance.profile
    const suffix = profile === "default" ? "" : `_${crypto.createHash("sha256").update(profile).digest("hex").slice(0, 12)}`
    const current = path.join(BASE_PATH, `project_${getProjectHash(projectPath)}${suffix}`)
    if (existsSync(current)) return current
    if (profile !== "default") return current
    const legacy = path.join(BASE_PATH, `project_${getLegacyProjectHash(projectPath)}`)
    return existsSync(legacy) ? legacy : current
  }

  export function getIndexStoragePath(projectPath: string): string {
    return projectDir(projectPath)
  }

  function indexMetaPath(projectPath: string): string {
    return path.join(projectDir(projectPath), "index-meta.json")
  }

  export type AddDocumentInput = {
    id: string
    content: string
    contentRaw?: string
    metadata: Record<string, string | number | boolean | null>
  }

  export type EmbeddedDocumentRow = {
    id: string
    content: string
    content_raw: string
    vector: number[]
    file: string
    startLine: number
    endLine: number
    chunkIndex: number
    type: string
    symbolName: string
    symbolType: string
    complexity: number
    isExported: boolean
    parentScope: string
    semanticKind: string
    framework: string
    scopeDepth: number
    hasDocumentation: boolean
    language: string
    imports: string
    calls: string
    fileKind: string
    fileRole: string
    variant: string
    isAsync: boolean
    isStatic: boolean
    isAbstract: boolean
    decorators: string
  }

  async function resolveProjectPath(projectPath: string): Promise<string> {
    return fs.realpath(projectPath).catch(() => path.resolve(projectPath))
  }

  function isSameOrInside(parentPath: string, childPath: string): boolean {
    const relative = path.relative(parentPath, childPath)
    return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  }

  async function listIndexedProjects(): Promise<Array<{ root: string; meta: IndexMeta; updatedAt: number }>> {
    const entries = await fs.readdir(BASE_PATH, { withFileTypes: true }).catch(() => [])
    const projects: Array<{ root: string; meta: IndexMeta; updatedAt: number }> = []

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("project_")) continue

      const metaPath = path.join(BASE_PATH, entry.name, "index-meta.json")
      const text = await fs.readFile(metaPath, "utf8").catch(() => null)
      if (!text) continue

      try {
        const parsed = IndexMetaSchema.safeParse(JSON.parse(text))
        if (!parsed.success) continue
        const meta = parsed.data as IndexMeta
        if (!isSupportedIndexMeta(meta)) continue
        if ((meta.profile ?? "default") !== Instance.profile) continue
        const root = await resolveProjectPath(meta.root)
        projects.push({ root, meta: { ...meta, root }, updatedAt: meta.updatedAt ?? 0 })
      } catch {
        continue
      }
    }

    return projects
  }

  export const REQUIRED_TABLE_FIELDS = [
    "id", "content", "content_raw", "vector", "file", "startLine", "endLine", "chunkIndex", "type",
    "symbolName", "symbolType", "complexity", "isExported", "parentScope", "semanticKind", "framework",
    "scopeDepth", "hasDocumentation", "language", "imports", "calls", "fileKind", "fileRole", "variant",
    "isAsync", "isStatic", "isAbstract", "decorators",
  ] as const
  const READ_ONLY_TABLE_FIELDS = ["id", "content", "vector", "file", "startLine", "endLine"] as const

  export class IndexSchemaMismatchError extends Error {
    readonly code = "INDEX_SCHEMA_MISMATCH"

    constructor(
      readonly projectPath: string,
      readonly tableName: string,
      readonly missingFields: string[],
    ) {
      super(
        `Index schema is incompatible for "${projectPath}" (${tableName}); missing fields: ${missingFields.join(", ")}. ` +
          "Run `sensegrep index --full --no-watch` to rebuild it atomically.",
      )
      this.name = "IndexSchemaMismatchError"
    }
  }

  export async function listProfiles(projectPath: string): Promise<Array<{
    profile: string
    updatedAt: number
    tableName?: string
    embeddings: IndexMeta["embeddings"]
  }>> {
    const requested = await resolveProjectPath(projectPath)
    const entries = await fs.readdir(BASE_PATH, { withFileTypes: true }).catch(() => [])
    const profiles: Array<{ profile: string; updatedAt: number; tableName?: string; embeddings: IndexMeta["embeddings"] }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("project_")) continue
      const raw = await fs.readFile(path.join(BASE_PATH, entry.name, "index-meta.json"), "utf8").catch(() => null)
      if (!raw) continue
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        continue
      }
      const parsed = IndexMetaSchema.safeParse(json)
      if (!parsed.success) continue
      const meta = parsed.data as IndexMeta
      if (await resolveProjectPath(meta.root) !== requested) continue
      profiles.push({
        profile: meta.profile ?? "default",
        updatedAt: meta.updatedAt ?? 0,
        tableName: meta.tableName,
        embeddings: meta.embeddings,
      })
    }
    return profiles.sort((left, right) => right.updatedAt - left.updatedAt || left.profile.localeCompare(right.profile))
  }

  const dbCache = new Map<string, Promise<LanceDBConnection>>()
  const tableCache = new Map<string, Promise<LanceTable>>()

  function tableCacheKey(projectPath: string, tableName: string): string {
    return `${projectPath}:${Instance.profile}:${tableName}:${Embeddings.getProvider()}:${Embeddings.getModel()}:${Embeddings.getDimension()}`
  }

  export function getDistanceMetric(meta?: IndexMeta | null): DistanceMetric {
    const metric = meta?.embeddings?.distanceMetric
    return metric === "l2" || metric === "dot" || metric === "cosine" ? metric : DEFAULT_DISTANCE_METRIC
  }

  export function isSupportedIndexMeta(meta?: IndexMeta | null): meta is IndexMeta {
    const provider = meta?.embeddings?.provider
    return provider === "gemini" || provider === "openai" || provider === "bedrock" || provider === "ollama"
  }

  export function distanceToSimilarity(distance: number, metric: DistanceMetric = DEFAULT_DISTANCE_METRIC): number {
    if (!Number.isFinite(distance)) return 0
    if (metric === "cosine") return 1 - distance
    if (metric === "l2") return 1 - (distance * distance) / 2
    return distance
  }

  function withDistanceMetric<T>(searchBuilder: T, metric: DistanceMetric): T {
    const builder = searchBuilder as any
    if (typeof builder.distanceType === "function") return builder.distanceType(metric)
    if (typeof builder.distance_type === "function") return builder.distance_type(metric)
    return searchBuilder
  }

  async function readVectorDimension(table: LanceTable): Promise<number | undefined> {
    const rows = await (table as any)
      .query()
      .select(["vector"])
      .limit(1)
      .toArray()
      .catch(() => [])

    if (!Array.isArray(rows) || rows.length === 0) return undefined

    const vector = (rows[0] as any)?.vector
    if (Array.isArray(vector)) return vector.length
    if (vector && typeof vector.length === "number") return Number(vector.length)

    return undefined
  }

  async function assertCompatibleDimension(
    projectPath: string,
    table: LanceTable,
    expectedDim?: number,
  ): Promise<void> {
    const expected = expectedDim ?? Embeddings.getDimension()
    const existing = await readVectorDimension(table)
    if (!existing) return
    if (existing === expected) return

    log.error("Dimension mismatch detected", { existing, expected, projectPath })
    throw new Error(
      `LanceDB index dimension mismatch for "${projectPath}": existing=${existing}, expected=${expected}. ` +
        `You changed the embeddings provider/model/dimension. ` +
        `Delete and reindex this project collection (VectorStore.deleteCollection(projectPath) or remove the index directory in ${BASE_PATH}).`,
    )
  }

  async function connect(projectPath: string): Promise<LanceDBConnection> {
    const cacheKey = `${projectPath}:${Instance.profile}`
    const existing = dbCache.get(cacheKey)
    if (existing) return existing

    const dir = projectDir(projectPath)
    const p = (async () => {
      await fs.mkdir(dir, { recursive: true })
      return lancedb.connect(dir)
    })()
    dbCache.set(cacheKey, p)
    return p
  }

  export async function readIndexMeta(projectPath: string): Promise<IndexMeta | null> {
    const filepath = indexMetaPath(projectPath)
    const text = await fs.readFile(filepath, "utf8").catch(() => null)
    if (!text) return null
    try {
      const result = IndexMetaSchema.safeParse(JSON.parse(text))
      if (result.success) return result.data as IndexMeta
      log.warn("Invalid index metadata", { projectPath, issues: result.error.issues.length })
      return null
    } catch (error) {
      log.warn("Failed to parse index metadata", {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  export async function writeIndexMeta(projectPath: string, meta: IndexMeta): Promise<void> {
    const dir = projectDir(projectPath)
    await fs.mkdir(dir, { recursive: true })
    const filepath = indexMetaPath(projectPath)
    const temporaryPath = `${filepath}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(meta, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
      await fs.rename(temporaryPath, filepath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
  }

  /**
   * Resolve the indexed project that should back a requested path.
   *
   * Exact root matches are preferred. If the requested path is a subdirectory
   * of an indexed root, reuse the nearest indexed parent and return the
   * repository-relative subdirectory prefix so callers can scope their query.
   */
  export async function resolveIndexedProject(projectPath: string): Promise<{
    root: string
    meta: IndexMeta
    requestedPath: string
    subdirPrefix?: string
  } | null> {
    const requestedPath = await resolveProjectPath(projectPath)
    const exactMeta = await readIndexMeta(requestedPath)
    if (isSupportedIndexMeta(exactMeta)) {
      return {
        root: requestedPath,
        meta: { ...exactMeta, root: requestedPath },
        requestedPath,
      }
    }

    const candidates = (await listIndexedProjects())
      .filter((project) => isSameOrInside(project.root, requestedPath))
      .sort((a, b) => b.root.length - a.root.length || b.updatedAt - a.updatedAt)

    const best = candidates[0]
    if (!best) return null

    const relative = path.relative(best.root, requestedPath).replace(/\\/g, "/").replace(/\/$/, "")
    return {
      root: best.root,
      meta: best.meta,
      requestedPath,
      subdirPrefix: relative || undefined,
    }
  }

  /**
   * Find the most recently indexed project
   * Useful when SENSEGREP_ROOT is not set and we need to auto-detect the project
   */
  export async function getMostRecentIndexedProject(): Promise<string | null> {
    try {
      const mostRecent = (await listIndexedProjects()).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      return mostRecent?.root ?? null
    } catch {
      return null
    }
  }

  async function inspectTableSchema(table: LanceTable): Promise<{ fields: string[]; missingFields: string[] }> {
    const schema = await table.schema()
    const fields = Array.isArray((schema as any)?.fields) ? (schema as any).fields : []
    const fieldNames = fields.map((field: any) => String(field?.name ?? "")).filter(Boolean)
    return {
      fields: fieldNames,
      missingFields: REQUIRED_TABLE_FIELDS.filter((name) => !fieldNames.includes(name)),
    }
  }

  async function openExistingTable(
    db: LanceDBConnection,
    projectPath: string,
    tableName: string,
  ): Promise<LanceTable> {
    const table = await db.openTable(tableName)
    const inspection = await inspectTableSchema(table)
    if (inspection.fields.length > 0 && inspection.missingFields.length > 0) {
      throw new IndexSchemaMismatchError(projectPath, tableName, inspection.missingFields)
    }
    return table
  }

  async function openReadableTable(db: LanceDBConnection, projectPath: string, tableName: string): Promise<LanceTable> {
    const table = await db.openTable(tableName)
    const inspection = await inspectTableSchema(table)
    const missingFields = READ_ONLY_TABLE_FIELDS.filter((name) => !inspection.fields.includes(name))
    if (inspection.fields.length > 0 && missingFields.length > 0) {
      throw new IndexSchemaMismatchError(projectPath, tableName, missingFields)
    }
    return table
  }

  async function ensureTable(
    db: LanceDBConnection,
    projectPath: string,
    expectedDim?: number,
    tableName = TABLE_NAME,
  ): Promise<LanceTable> {
    const tableNames = await db.tableNames()
    if (tableNames.includes(tableName)) {
      const table = await openExistingTable(db, projectPath, tableName)
      log.debug("Opened existing table", { tableName })
      return table
    }

    // Create table lazily on first insert. We create a single sentinel row and
    // delete it right away to avoid schema inference issues on empty creates.
    const dim = expectedDim ?? Embeddings.getDimension()
    log.debug("Creating new table", { tableName, dimension: dim })
    const sentinel = {
      id: "__opencode_init__",
      content: "",
      content_raw: "",
      vector: Array.from({ length: dim }, () => 0),
      file: "",
      startLine: 0,
      endLine: 0,
      chunkIndex: 0,
      type: "",
      // Semantic metadata (nullable)
      symbolName: "",
      symbolType: "",
      complexity: 0,
      isExported: false,
      parentScope: "",
      semanticKind: "",
      framework: "",
      scopeDepth: 0,
      hasDocumentation: false,
      language: "",
      imports: "",
      calls: "",
      fileKind: "",
      fileRole: "implementation",
      // Multilingual support fields
      variant: "",
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: "",
    }
    const created = await db.createTable(tableName, [sentinel], {
      mode: "overwrite",
    } as any)
    await created.delete("id = '__opencode_init__'")
    return created
  }

  function escapeSqlString(value: string): string {
    return value.replaceAll("'", "''")
  }

  function expandFilePathVariants(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "")
    const variants = new Set<string>([
      filePath,
      filePath.replace(/\\/g, "/"),
      filePath.replace(/\//g, "\\"),
      normalized,
      normalized.replace(/\//g, "\\"),
    ])

    if (normalized && !normalized.startsWith("./")) {
      variants.add(`./${normalized}`)
      variants.add(`.\\${normalized.replace(/\//g, "\\")}`)
    }

    return [...variants].filter(Boolean)
  }

  function buildWhere(where?: Record<string, string>): string | undefined {
    if (!where) return undefined
    const parts: string[] = []
    for (const [key, value] of Object.entries(where)) {
      // only allow simple identifiers to avoid injection
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue
      parts.push(`${key} = '${escapeSqlString(String(value))}'`)
    }
    return parts.length ? parts.join(" AND ") : undefined
  }

  /**
   * Build SQL WHERE clause from structured filters
   */
  function buildWhereFromFilters(filters?: SearchFilters): string | undefined {
    if (!filters) return undefined

    const clauses: string[] = []

    // Build AND conditions (all must match)
    if (filters.all && filters.all.length > 0) {
      const allConditions = filters.all.map((filter) => buildFilterCondition(filter)).filter(Boolean)
      if (allConditions.length > 0) {
        clauses.push(`(${allConditions.join(" AND ")})`)
      }
    }

    // Build OR conditions (at least one must match)
    if (filters.any && filters.any.length > 0) {
      const anyConditions = filters.any.map((filter) => buildFilterCondition(filter)).filter(Boolean)
      if (anyConditions.length > 0) {
        clauses.push(`(${anyConditions.join(" OR ")})`)
      }
    }

    // Build NOT conditions (none must match)
    if (filters.none && filters.none.length > 0) {
      const noneConditions = filters.none.map((filter) => buildFilterCondition(filter)).filter(Boolean)
      if (noneConditions.length > 0) {
        clauses.push(`NOT (${noneConditions.join(" OR ")})`)
      }
    }

    return clauses.length > 0 ? clauses.join(" AND ") : undefined
  }

  /**
   * Build a single filter condition as SQL
   */
  function buildFilterCondition(filter: Filter): string | null {
    const { key, operator, value } = filter

    // Validate key to prevent SQL injection (only allow simple identifiers)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      log.warn("invalid filter key, ignoring", { key })
      return null
    }

    // LanceDB SQL uses backticks for quoted identifiers to preserve case sensitivity
    const fieldName = `\`${key}\``

    // Handle different operators
    switch (operator) {
      case "equals":
        if (typeof value === "string") {
          return `${fieldName} = '${escapeSqlString(value)}'`
        }
        if (typeof value === "number") {
          return `${fieldName} = ${value}`
        }
        if (typeof value === "boolean") {
          return `${fieldName} = ${value}`
        }
        return null

      case "not_equals":
        if (typeof value === "string") {
          return `${fieldName} != '${escapeSqlString(value)}'`
        }
        if (typeof value === "number") {
          return `${fieldName} != ${value}`
        }
        if (typeof value === "boolean") {
          return `${fieldName} != ${value}`
        }
        return null

      case "contains":
        if (typeof value === "string") {
          return `${fieldName} LIKE '%${escapeSqlString(value)}%'`
        }
        return null

      case "starts_with":
        if (typeof value === "string") {
          return `${fieldName} LIKE '${escapeSqlString(value)}%'`
        }
        return null

      case "ends_with":
        if (typeof value === "string") {
          return `${fieldName} LIKE '%${escapeSqlString(value)}'`
        }
        return null

      case "greater_than":
        if (typeof value === "number") {
          return `${fieldName} > ${value}`
        }
        return null

      case "less_than":
        if (typeof value === "number") {
          return `${fieldName} < ${value}`
        }
        return null

      case "greater_or_equal":
        if (typeof value === "number") {
          return `${fieldName} >= ${value}`
        }
        return null

      case "less_or_equal":
        if (typeof value === "number") {
          return `${fieldName} <= ${value}`
        }
        return null

      case "in":
        if (Array.isArray(value)) {
          if (value.length === 0) return null
          const values = value
            .map((v) => {
              if (typeof v === "string") return `'${escapeSqlString(v)}'`
              if (typeof v === "number") return String(v)
              return null
            })
            .filter(Boolean)
          if (values.length === 0) return null
          return `${fieldName} IN (${values.join(", ")})`
        }
        return null

      case "not_in":
        if (Array.isArray(value)) {
          if (value.length === 0) return null
          const values = value
            .map((v) => {
              if (typeof v === "string") return `'${escapeSqlString(v)}'`
              if (typeof v === "number") return String(v)
              return null
            })
            .filter(Boolean)
          if (values.length === 0) return null
          return `${fieldName} NOT IN (${values.join(", ")})`
        }
        return null

      default:
        log.warn("unknown filter operator, ignoring", { operator })
        return null
    }
  }

  /**
   * Get or create a table for a project.
   */
  export async function getCollection(projectPath: string): Promise<LanceTable> {
    const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
    const key = tableCacheKey(projectPath, tableName)
    const cached = tableCache.get(key)
    if (cached) return cached

    const p = (async () => {
      const db = await connect(projectPath)
      const table = await openExistingTable(db, projectPath, tableName)
      await assertCompatibleDimension(projectPath, table)
      return table
    })()

    tableCache.set(key, p)
    return p
  }

  /**
   * Get or create a table WITHOUT validating dimension.
   * Use this only when you need to read stats before configuring embeddings.
   * @param expectedDim - If provided, uses this dimension for validation/creation instead of reading from global config
   */
  export async function getCollectionUnsafe(projectPath: string, expectedDim?: number): Promise<LanceTable> {
    const db = await connect(projectPath)
    const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
    return await openExistingTable(db, projectPath, tableName)
  }

  export async function openCollectionReadOnly(projectPath: string): Promise<LanceTable> {
    const db = await connect(projectPath)
    const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
    return openReadableTable(db, projectPath, tableName)
  }

  export async function getOrCreateCollection(projectPath: string, expectedDim?: number): Promise<LanceTable> {
    const db = await connect(projectPath)
    const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
    return ensureTable(db, projectPath, expectedDim, tableName)
  }

  export async function inspectCollectionSchema(projectPath: string): Promise<{
    exists: boolean
    tableName: string
    schemaCompatible: boolean
    migrationRequired: boolean
    fields: string[]
    missingFields: string[]
    vectorDimension?: number
  }> {
    const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
    const db = await connect(projectPath)
    let table: LanceTable
    try {
      table = await db.openTable(tableName)
    } catch {
      return { exists: false, tableName, schemaCompatible: false, migrationRequired: false, fields: [], missingFields: [] }
    }
    const schema = await inspectTableSchema(table).catch(() => ({ fields: [], missingFields: [...REQUIRED_TABLE_FIELDS] as string[] }))
    return {
      exists: true,
      tableName,
      schemaCompatible: schema.missingFields.length === 0,
      migrationRequired: schema.missingFields.length > 0,
      fields: schema.fields,
      missingFields: schema.missingFields,
      vectorDimension: await readVectorDimension(table),
    }
  }

  export async function createStagingCollection(
    projectPath: string,
    expectedDim: number,
  ): Promise<{ collection: LanceTable; tableName: string }> {
    const db = await connect(projectPath)
    const tableName = `chunks_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`
    const collection = await ensureTable(db, projectPath, expectedDim, tableName)
    return { collection, tableName }
  }

  export async function openCollectionTable(
    projectPath: string,
    tableName: string,
    expectedDim: number,
  ): Promise<LanceTable> {
    const db = await connect(projectPath)
    return ensureTable(db, projectPath, expectedDim, tableName)
  }

  export async function dropCollectionTable(projectPath: string, tableName: string): Promise<void> {
    const db = await connect(projectPath)
    await db.dropTable(tableName)
    for (const key of tableCache.keys()) {
      if (key.startsWith(`${projectPath}:${Instance.profile}:${tableName}:`)) tableCache.delete(key)
    }
  }

  export async function cleanupInactiveTables(projectPath: string, activeTableName: string): Promise<void> {
    const db = await connect(projectPath)
    const tableNames = await db.tableNames()
    const retentionMs = Math.max(60_000, Number(process.env.SENSEGREP_INDEX_RETENTION_MS ?? 24 * 60 * 60_000))
    const retainGenerations = Math.max(1, Number(process.env.SENSEGREP_INDEX_RETAIN_GENERATIONS ?? 2))
    const cutoff = Date.now() - retentionMs
    const generations = tableNames
      .filter((name) => name !== activeTableName && name.startsWith("chunks_"))
      .map((name) => ({ name, timestamp: Number(name.split("_", 3)[1]) }))
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort((left, right) => right.timestamp - left.timestamp)
    const inactive = generations
      .filter((entry, index) => index >= retainGenerations && entry.timestamp < cutoff)
      .map((entry) => entry.name)
    for (const tableName of inactive) {
      await dropCollectionTable(projectPath, tableName).catch((error) => {
        log.warn("Failed to remove inactive index table", {
          projectPath,
          tableName,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  export async function optimizeForSearch(collection: LanceTable, rowCount: number): Promise<boolean> {
    const configured = Number(process.env.SENSEGREP_ANN_MIN_CHUNKS ?? 10_000)
    if (!Number.isFinite(configured) || configured < 0) {
      throw new Error(`SENSEGREP_ANN_MIN_CHUNKS must be a non-negative number, got "${process.env.SENSEGREP_ANN_MIN_CHUNKS}".`)
    }
    if (configured === 0 || rowCount < configured || typeof (collection as any).createIndex !== "function") return false
    const existing = typeof (collection as any).listIndices === "function"
      ? await (collection as any).listIndices().catch(() => [])
      : []
    const names = new Set((existing as any[]).map((index) => String(index?.name ?? index)))
    for (const column of ["vector", "file", "symbolName"]) {
      if (names.has(`${column}_idx`)) continue
      await (collection as any).createIndex(column).catch((error: unknown) => {
        log.warn("Failed to create search index", { column, error: error instanceof Error ? error.message : String(error) })
      })
    }
    if (typeof (collection as any).optimize === "function") await (collection as any).optimize().catch(() => {})
    return true
  }

  function documentToRow(document: AddDocumentInput, vector: number[]): EmbeddedDocumentRow {
    const md = document.metadata
    return {
      id: document.id,
      content: document.content,
      content_raw: document.contentRaw ?? document.content,
      vector,
      file: String(md.file ?? ""),
      startLine: Number(md.startLine ?? 0),
      endLine: Number(md.endLine ?? 0),
      chunkIndex: Number(md.chunkIndex ?? 0),
      type: String(md.type ?? ""),
      // Semantic metadata (optional fields)
      symbolName: md.symbolName ? String(md.symbolName) : "",
      symbolType: md.symbolType ? String(md.symbolType) : "",
      complexity: md.complexity !== undefined ? Number(md.complexity) : 0,
      isExported: md.isExported !== undefined ? Boolean(md.isExported) : false,
      parentScope: md.parentScope ? String(md.parentScope) : "",
      semanticKind: md.semanticKind ? String(md.semanticKind) : "",
      framework: md.framework ? String(md.framework) : "",
      scopeDepth: md.scopeDepth !== undefined ? Number(md.scopeDepth) : 0,
      hasDocumentation: md.hasDocumentation !== undefined ? Boolean(md.hasDocumentation) : false,
      language: md.language ? String(md.language) : "",
      imports: md.imports ? String(md.imports) : "",
      calls: md.calls ? String(md.calls) : "",
      fileKind: md.fileKind ? String(md.fileKind) : "code",
      fileRole: md.fileRole ? String(md.fileRole) : "implementation",
      // Multilingual support fields
      variant: md.variant ? String(md.variant) : "",
      isAsync: md.isAsync !== undefined ? Boolean(md.isAsync) : false,
      isStatic: md.isStatic !== undefined ? Boolean(md.isStatic) : false,
      isAbstract: md.isAbstract !== undefined ? Boolean(md.isAbstract) : false,
      decorators: Array.isArray(md.decorators) ? md.decorators.join(",") : (md.decorators ? String(md.decorators) : ""),
    }
  }

  export async function embedDocuments(
    documents: AddDocumentInput[],
    options: { signal?: AbortSignal } = {},
  ): Promise<EmbeddedDocumentRow[]> {
    if (documents.length === 0) return []

    const contents = documents.map((d) => d.content)
    const embeddings = await Embeddings.embed(contents, {
      taskType: "RETRIEVAL_DOCUMENT",
      title: documents.map((d) => String(d.metadata.file ?? "")),
      signal: options.signal,
    })
    const expectedDim = Embeddings.getDimension()
    if (embeddings.length !== documents.length) {
      throw new Error(`Embedding provider returned ${embeddings.length} vectors for ${documents.length} documents.`)
    }
    const invalidIndex = embeddings.findIndex(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length !== expectedDim ||
        vector.some((value) => !Number.isFinite(value)),
    )
    if (invalidIndex >= 0) {
      const actualDim = Array.isArray(embeddings[invalidIndex]) ? embeddings[invalidIndex].length : 0
      throw new Error(`Embedding vector ${invalidIndex} has dimension ${actualDim}; expected ${expectedDim}.`)
    }

    return documents.map((document, i) => documentToRow(document, embeddings[i]))
  }

  export function materializeDocument(document: AddDocumentInput, vector: number[]): EmbeddedDocumentRow {
    return documentToRow(document, vector)
  }

  export async function embedDocumentsReusingFile(
    collection: LanceTable,
    filePath: string,
    documents: AddDocumentInput[],
    options: { signal?: AbortSignal } = {},
  ): Promise<{ rows: EmbeddedDocumentRow[]; embedded: number; reused: number }> {
    if (documents.length === 0) return { rows: [], embedded: 0, reused: 0 }
    const previous = await listDocuments(collection, {
      filters: { all: [{ key: "file", operator: "in", value: expandFilePathVariants(filePath) }] },
      columns: ["id", "content", "vector"],
    })
    const expectedDim = Embeddings.getDimension()
    const reusable = new Map<string, number[][]>()
    for (const row of previous) {
      if (!Array.isArray(row.vector) || row.vector.length !== expectedDim) continue
      const hash = crypto.createHash("sha1").update(row.content).digest("hex")
      const vectors = reusable.get(hash) ?? []
      vectors.push(row.vector.map(Number))
      reusable.set(hash, vectors)
    }

    const rows: Array<EmbeddedDocumentRow | undefined> = new Array(documents.length)
    const pending: AddDocumentInput[] = []
    const pendingPositions: number[] = []
    let reused = 0
    for (let index = 0; index < documents.length; index++) {
      const document = documents[index]
      const hash = crypto.createHash("sha1").update(document.content).digest("hex")
      const vector = reusable.get(hash)?.shift()
      if (vector) {
        rows[index] = documentToRow(document, vector)
        reused++
      } else {
        pending.push(document)
        pendingPositions.push(index)
      }
    }

    const embeddedRows = await embedDocuments(pending, options)
    for (let index = 0; index < embeddedRows.length; index++) {
      rows[pendingPositions[index]] = embeddedRows[index]
    }
    return { rows: rows.filter((row): row is EmbeddedDocumentRow => Boolean(row)), embedded: pending.length, reused }
  }

  export async function reuseDocumentVectors<T extends AddDocumentInput>(
    collection: LanceTable,
    documents: T[],
    options: { signal?: AbortSignal } = {},
  ): Promise<{ rows: EmbeddedDocumentRow[]; pending: T[]; reused: number }> {
    if (documents.length === 0) return { rows: [], pending: [], reused: 0 }
    options.signal?.throwIfAborted()
    const previous = await listDocuments(collection, {
      columns: ["content", "file", "vector"],
    })
    const expectedDim = Embeddings.getDimension()
    const reusable = new Map<string, number[][]>()
    const reuseKey = (file: unknown, content: string) => crypto
      .createHash("sha1")
      .update(`${String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "")}\0${content}`)
      .digest("hex")

    for (const row of previous) {
      if (!Array.isArray(row.vector) || row.vector.length !== expectedDim) continue
      const key = reuseKey(row.metadata.file, row.content)
      const vectors = reusable.get(key) ?? []
      vectors.push(row.vector.map(Number))
      reusable.set(key, vectors)
    }

    const rows: EmbeddedDocumentRow[] = []
    const pending: T[] = []
    for (const document of documents) {
      options.signal?.throwIfAborted()
      const key = reuseKey(document.metadata.file, document.content)
      const vector = reusable.get(key)?.shift()
      if (vector) rows.push(documentToRow(document, vector))
      else pending.push(document)
    }
    return { rows, pending, reused: rows.length }
  }

  export async function addEmbeddedDocuments(
    collection: LanceTable,
    rows: EmbeddedDocumentRow[],
  ): Promise<void> {
    if (rows.length === 0) return

    log.info("adding documents", { count: rows.length })
    // LanceDB JS uses append-by-default semantics.
    await (collection as any).add(rows)
  }

  export async function addDocuments(
    collection: LanceTable,
    documents: AddDocumentInput[],
  ): Promise<void> {
    if (documents.length === 0) return
    await addEmbeddedDocuments(collection, await embedDocuments(documents))
  }

  export async function updateDocuments(
    collection: LanceTable,
    documents: {
      id: string
      content: string
      contentRaw?: string
      metadata: Record<string, string | number | boolean | null>
    }[],
  ): Promise<void> {
    if (documents.length === 0) return
    await deleteDocuments(
      collection,
      documents.map((d) => d.id),
    )
    await addDocuments(collection, documents)
  }

  export async function deleteDocuments(collection: LanceTable, ids: string[]): Promise<void> {
    if (ids.length === 0) return

    // Chunk to keep the predicate from getting too large.
    const CHUNK = 200
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const inList = chunk.map((id) => `'${escapeSqlString(id)}'`).join(", ")
      await (collection as any).delete(`id IN (${inList})`)
    }
  }

  export async function deleteByFile(collection: LanceTable, filePath: string): Promise<void> {
    const variants = expandFilePathVariants(filePath)
    const predicate = variants.map((value) => `file = '${escapeSqlString(value)}'`).join(" OR ")
    await (collection as any).delete(predicate)
  }

  export async function replaceFileDocuments(
    collection: LanceTable,
    filePath: string,
    rows: EmbeddedDocumentRow[],
  ): Promise<void> {
    const variants = expandFilePathVariants(filePath)
    const predicate = variants.map((value) => `file = '${escapeSqlString(value)}'`).join(" OR ")
    const previousRows: EmbeddedDocumentRow[] = await (collection as any)
      .query()
      .where(predicate)
      .toArray()
      .then((items: any[]) => items.map((item) => ({
        ...item,
        vector: Array.from(item.vector ?? [], Number),
      })))

    await deleteByFile(collection, filePath)
    try {
      await addEmbeddedDocuments(collection, rows)
    } catch (error) {
      await deleteByFile(collection, filePath).catch(() => {})
      if (previousRows.length > 0) {
        await addEmbeddedDocuments(collection, previousRows).catch((restoreError) => {
          log.error("Failed to restore file rows after replacement error", {
            filePath,
            error: restoreError instanceof Error ? restoreError.message : String(restoreError),
          })
        })
      }
      throw error
    }
  }

  export async function countByFile(collection: LanceTable, filePath: string): Promise<number> {
    // Best-effort: query ids and count. (Used rarely.)
    const variants = expandFilePathVariants(filePath)
    const predicate = variants.map((value) => `file = '${escapeSqlString(value)}'`).join(" OR ")
    const rows = await (collection as any)
      .query()
      .where(predicate)
      .select(["id"])
      .toArray()
    return Array.isArray(rows) ? rows.length : 0
  }

  function mapRow(row: any) {
    const vector = row?.vector
    const vectorArray =
      Array.isArray(vector) ? vector : vector && typeof vector.length === "number" ? Array.from(vector) : undefined
    return {
      id: String(row?.id ?? ""),
      content: String(row?.content ?? ""),
      contentRaw: String(row?.content_raw ?? row?.content ?? ""),
      vector: vectorArray,
      metadata: {
        file: String(row?.file ?? ""),
        startLine: Number(row?.startLine ?? 0),
        endLine: Number(row?.endLine ?? 0),
        chunkIndex: Number(row?.chunkIndex ?? 0),
        type: String(row?.type ?? ""),
        symbolName: row?.symbolName ? String(row.symbolName) : undefined,
        symbolType: row?.symbolType ? String(row.symbolType) : undefined,
        complexity: row?.complexity !== undefined ? Number(row.complexity) : undefined,
        isExported: row?.isExported !== undefined ? Boolean(row.isExported) : undefined,
        parentScope: row?.parentScope ? String(row.parentScope) : undefined,
        semanticKind: row?.semanticKind ? String(row.semanticKind) : undefined,
        framework: row?.framework ? String(row.framework) : undefined,
        scopeDepth: row?.scopeDepth !== undefined ? Number(row.scopeDepth) : undefined,
        hasDocumentation: row?.hasDocumentation !== undefined ? Boolean(row.hasDocumentation) : undefined,
        language: row?.language ? String(row.language) : undefined,
        imports: row?.imports ? String(row.imports) : undefined,
        calls: row?.calls ? String(row.calls) : undefined,
        fileKind: row?.fileKind ? String(row.fileKind) : undefined,
        fileRole: row?.fileRole ? String(row.fileRole) : undefined,
        // Multilingual support fields
        variant: row?.variant ? String(row.variant) : undefined,
        isAsync: row?.isAsync !== undefined ? Boolean(row.isAsync) : undefined,
        isStatic: row?.isStatic !== undefined ? Boolean(row.isStatic) : undefined,
        isAbstract: row?.isAbstract !== undefined ? Boolean(row.isAbstract) : undefined,
        decorators: row?.decorators ? String(row.decorators).split(",").filter(Boolean) : undefined,
      },
      distance: Number(row?._distance ?? row?.distance ?? 0),
    }
  }

  export async function listDocuments(
    collection: LanceTable,
    options: {
      limit?: number
      where?: Record<string, string>
      filters?: SearchFilters
      signal?: AbortSignal
      columns?: string[]
    } = {},
  ): Promise<ReturnType<typeof mapRow>[]> {
    let whereClause: string | undefined
    if (options.filters) {
      whereClause = buildWhereFromFilters(options.filters)
    } else if (options.where) {
      whereClause = buildWhere(options.where)
    }

    let query = (collection as any).query()
    if (options.columns && options.columns.length > 0) {
      query = query.select(options.columns)
    }
    if (whereClause) query = query.where(whereClause)
    if (options.limit && options.limit > 0) query = query.limit(options.limit)

    const rows: any[] = await query.toArray()
    return rows.map(mapRow)
  }

  export async function searchByVector(
    collection: LanceTable,
    vector: number[],
    options: {
      limit?: number
      where?: Record<string, string>
      filters?: SearchFilters
      signal?: AbortSignal
    } = {},
  ): Promise<ReturnType<typeof mapRow>[]> {
    options.signal?.throwIfAborted()
    const limit = options.limit ?? 20

    let whereClause: string | undefined
    if (options.filters) {
      whereClause = buildWhereFromFilters(options.filters)
    } else if (options.where) {
      whereClause = buildWhere(options.where)
    }

    let searchBuilder = withDistanceMetric((collection as any).vectorSearch(vector), DEFAULT_DISTANCE_METRIC).limit(limit)
    if (whereClause) searchBuilder = searchBuilder.where(whereClause)

    const rows: any[] = await searchBuilder.toArray()
    options.signal?.throwIfAborted()
    return rows.map(mapRow)
  }

  export async function search(
    collection: LanceTable,
    query: string,
    options: {
      limit?: number
      where?: Record<string, string> // Legacy format (kept for backward compatibility)
      filters?: SearchFilters // New structured filters
      signal?: AbortSignal
      retryDeadlineMs?: number
    } = {},
  ): Promise<
    {
      id: string
      content: string
      metadata: Record<string, string | number | boolean | string[] | undefined>
      distance: number
    }[]
  > {
    const limit = options.limit ?? 20
    const deadlineMs = options.retryDeadlineMs ?? 15_000
    const timeoutSignal = AbortSignal.timeout(deadlineMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    const [queryEmbedding] = await Embeddings.embed(query, {
      taskType: "RETRIEVAL_QUERY",
      signal,
      operation: "query",
      retryDeadlineMs: deadlineMs,
    })
    signal.throwIfAborted()

    // Build WHERE clause: prioritize structured filters, fall back to legacy where
    let whereClause: string | undefined
    if (options.filters) {
      whereClause = buildWhereFromFilters(options.filters)
    } else if (options.where) {
      whereClause = buildWhere(options.where)
    }

    // LanceDB returns rows with a `_distance` column for vector searches.
    let searchBuilder = withDistanceMetric((collection as any).vectorSearch(queryEmbedding), DEFAULT_DISTANCE_METRIC).limit(limit)
    if (whereClause) searchBuilder = searchBuilder.where(whereClause)

    const rows: any[] = await searchBuilder.toArray()

    return rows.map((r) => ({
      id: String(r.id ?? ""),
      content: String(r.content ?? ""),
      metadata: {
        file: String(r.file ?? ""),
        startLine: Number(r.startLine ?? 0),
        endLine: Number(r.endLine ?? 0),
        chunkIndex: Number(r.chunkIndex ?? 0),
        type: String(r.type ?? ""),
        // Include semantic metadata if present
        symbolName: r.symbolName ? String(r.symbolName) : undefined,
        symbolType: r.symbolType ? String(r.symbolType) : undefined,
        complexity: r.complexity !== undefined ? Number(r.complexity) : undefined,
        isExported: r.isExported !== undefined ? Boolean(r.isExported) : undefined,
        parentScope: r.parentScope ? String(r.parentScope) : undefined,
        semanticKind: r.semanticKind ? String(r.semanticKind) : undefined,
        framework: r.framework ? String(r.framework) : undefined,
        scopeDepth: r.scopeDepth !== undefined ? Number(r.scopeDepth) : undefined,
        hasDocumentation: r.hasDocumentation !== undefined ? Boolean(r.hasDocumentation) : undefined,
        language: r.language ? String(r.language) : undefined,
        imports: r.imports ? String(r.imports) : undefined,
        calls: r.calls ? String(r.calls) : undefined,
        fileKind: r.fileKind ? String(r.fileKind) : undefined,
        fileRole: r.fileRole ? String(r.fileRole) : undefined,
        // Multilingual support fields
        variant: r.variant ? String(r.variant) : undefined,
        isAsync: r.isAsync !== undefined ? Boolean(r.isAsync) : undefined,
        isStatic: r.isStatic !== undefined ? Boolean(r.isStatic) : undefined,
        isAbstract: r.isAbstract !== undefined ? Boolean(r.isAbstract) : undefined,
        decorators: r.decorators ? String(r.decorators).split(",").filter(Boolean) : undefined,
      },
      distance: Number(r._distance ?? r.distance ?? 0),
    }))
  }

  export async function getStats(collection: LanceTable): Promise<{ count: number; name: string }> {
    const count = await (collection as any).countRows?.().catch(() => undefined)
    if (typeof count === "number") {
      return { count, name: TABLE_NAME }
    }

    // Fallback: count via query.
    const rows = await (collection as any).query().select(["id"]).toArray()
    return { count: Array.isArray(rows) ? rows.length : 0, name: TABLE_NAME }
  }

  export function clearProjectCache(projectPath: string): void {
    for (const key of dbCache.keys()) {
      if (key.startsWith(`${projectPath}:`)) dbCache.delete(key)
    }
    for (const key of tableCache.keys()) {
      if (key.startsWith(`${projectPath}:`)) tableCache.delete(key)
    }
  }

  export async function deleteCollection(projectPath: string): Promise<void> {
    clearProjectCache(projectPath)
    await fs.rm(projectDir(projectPath), { recursive: true, force: true })
  }

  export async function hasCollection(projectPath: string): Promise<boolean> {
    try {
      await fs.stat(projectDir(projectPath))
    } catch {
      return false
    }

    try {
      const db = await connect(projectPath)
      const tableName = (await readIndexMeta(projectPath))?.tableName ?? TABLE_NAME
      await db.openTable(tableName)
      return true
    } catch {
      return false
    }
  }
}
