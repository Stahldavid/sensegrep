import * as lancedb from "@lancedb/lancedb"
import path from "path"
import fs from "fs/promises"

import { Log } from "../util/log.js"
import { Global } from "../global/index.js"
import { Embeddings } from "./embeddings.js"

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

  export type IndexMeta = {
    version: number
    root: string
    embeddings: {
      provider: string
      model?: string
      dimension: number
      device?: string
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

  function getProjectHash(projectPath: string): string {
    let hash = 0
    for (let i = 0; i < projectPath.length; i++) {
      hash = (hash << 5) - hash + projectPath.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }

  function projectDir(projectPath: string): string {
    return path.join(BASE_PATH, `project_${getProjectHash(projectPath)}`)
  }

  function indexMetaPath(projectPath: string): string {
    return path.join(projectDir(projectPath), "index-meta.json")
  }

  const dbCache = new Map<string, Promise<LanceDBConnection>>()
  const tableCache = new Map<string, Promise<LanceTable>>()

  function tableCacheKey(projectPath: string): string {
    return `${projectPath}:${Embeddings.getProvider()}:${Embeddings.getModel()}:${Embeddings.getDimension()}`
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
    const existing = dbCache.get(projectPath)
    if (existing) return existing

    const dir = projectDir(projectPath)
    const p = (async () => {
      await fs.mkdir(dir, { recursive: true })
      return lancedb.connect(dir)
    })()
    dbCache.set(projectPath, p)
    return p
  }

  export async function readIndexMeta(projectPath: string): Promise<IndexMeta | null> {
    const filepath = indexMetaPath(projectPath)
    const text = await fs.readFile(filepath, "utf8").catch(() => null)
    if (!text) return null
    try {
      const parsed = JSON.parse(text) as IndexMeta
      if (!parsed || typeof parsed !== "object") return null
      return parsed
    } catch {
      return null
    }
  }

  export async function writeIndexMeta(projectPath: string, meta: IndexMeta): Promise<void> {
    const dir = projectDir(projectPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(indexMetaPath(projectPath), JSON.stringify(meta, null, 2))
  }

  /**
   * Find the most recently indexed project
   * Useful when SENSEGREP_ROOT is not set and we need to auto-detect the project
   */
  export async function getMostRecentIndexedProject(): Promise<string | null> {
    try {
      const entries = await fs.readdir(BASE_PATH, { withFileTypes: true })
      const projectDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("project_"))

      let mostRecent: { root: string; updatedAt: number } | null = null

      for (const dir of projectDirs) {
        const metaPath = path.join(BASE_PATH, dir.name, "index-meta.json")
        const text = await fs.readFile(metaPath, "utf8").catch(() => null)
        if (!text) continue

        try {
          const meta = JSON.parse(text) as IndexMeta
          if (!meta.root || !meta.updatedAt) continue

          if (!mostRecent || meta.updatedAt > mostRecent.updatedAt) {
            mostRecent = { root: meta.root, updatedAt: meta.updatedAt }
          }
        } catch {
          continue
        }
      }

      return mostRecent?.root || null
    } catch {
      return null
    }
  }

  async function ensureTable(db: LanceDBConnection, expectedDim?: number): Promise<LanceTable> {
    let table: LanceTable | null = null
    let needsCreate = false

    try {
      table = await db.openTable(TABLE_NAME)
    } catch (error) {
      needsCreate = true
    }

    if (table && !needsCreate) {
      try {
        const schema = await table.schema()
        const fields = Array.isArray((schema as any)?.fields) ? (schema as any).fields : []
        const fieldNames = fields.map((field: any) => field?.name).filter(Boolean)
        const required = [
          "id",
          "content",
          "content_raw",
          "vector",
          "file",
          "startLine",
          "endLine",
          "chunkIndex",
          "type",
          "symbolName",
          "symbolType",
          "complexity",
          "isExported",
          "parentScope",
          "scopeDepth",
          "hasDocumentation",
          "language",
          "imports",
          // Multilingual support fields
          "variant",
          "isAsync",
          "isStatic",
          "isAbstract",
          "decorators",
        ]
        if (fieldNames.length > 0 && required.some((name) => !fieldNames.includes(name))) {
          log.warn("Existing table schema missing fields; recreating", {
            tableName: TABLE_NAME,
            missing: required.filter((name) => !fieldNames.includes(name)),
          })
          try {
            await db.dropTable(TABLE_NAME)
          } catch {
            // ignore drop failures and fall back to create
          }
          needsCreate = true
        }
      } catch {
        // If schema fetch fails, keep existing table
      }
    }

    if (table && !needsCreate) {
      log.debug("Opened existing table", { tableName: TABLE_NAME })
      return table
    }

    // Create table lazily on first insert. We create a single sentinel row and
    // delete it right away to avoid schema inference issues on empty creates.
    const dim = expectedDim ?? Embeddings.getDimension()
    log.debug("Creating new table", { tableName: TABLE_NAME, dimension: dim })
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
      scopeDepth: 0,
      hasDocumentation: false,
      language: "",
      imports: "",
      // Multilingual support fields
      variant: "",
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: "",
    }
    const created = await db.createTable(TABLE_NAME, [sentinel], {
      mode: "overwrite",
    } as any)
    await created.delete("id = '__opencode_init__'")
    return created
  }

  function escapeSqlString(value: string): string {
    return value.replaceAll("'", "''")
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
    const key = tableCacheKey(projectPath)
    const cached = tableCache.get(key)
    if (cached) return cached

    const p = (async () => {
      const db = await connect(projectPath)
      const table = await ensureTable(db)
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
    return await ensureTable(db, expectedDim)
  }

  export async function addDocuments(
    collection: LanceTable,
    documents: {
      id: string
      content: string
      contentRaw?: string
      metadata: Record<string, string | number | boolean | null>
    }[],
  ): Promise<void> {
    if (documents.length === 0) return

    const contents = documents.map((d) => d.content)
    const embeddings = await Embeddings.embed(contents, {
      taskType: "RETRIEVAL_DOCUMENT",
      title: documents.map((d) => String(d.metadata.file ?? "")),
    })

    const rows = documents.map((d, i) => {
      const md = d.metadata
      return {
        id: d.id,
        content: d.content,
        content_raw: d.contentRaw ?? d.content,
        vector: embeddings[i],
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
        scopeDepth: md.scopeDepth !== undefined ? Number(md.scopeDepth) : 0,
        hasDocumentation: md.hasDocumentation !== undefined ? Boolean(md.hasDocumentation) : false,
        language: md.language ? String(md.language) : "",
        imports: md.imports ? String(md.imports) : "",
        // Multilingual support fields
        variant: md.variant ? String(md.variant) : "",
        isAsync: md.isAsync !== undefined ? Boolean(md.isAsync) : false,
        isStatic: md.isStatic !== undefined ? Boolean(md.isStatic) : false,
        isAbstract: md.isAbstract !== undefined ? Boolean(md.isAbstract) : false,
        decorators: Array.isArray(md.decorators) ? md.decorators.join(",") : (md.decorators ? String(md.decorators) : ""),
      }
    })

    log.info("adding documents", { count: rows.length })
    // LanceDB JS uses append-by-default semantics.
    await (collection as any).add(rows)
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
    await (collection as any).delete(`file = '${escapeSqlString(filePath)}'`)
  }

  export async function countByFile(collection: LanceTable, filePath: string): Promise<number> {
    // Best-effort: query ids and count. (Used rarely.)
    const rows = await (collection as any)
      .query()
      .where(`file = '${escapeSqlString(filePath)}'`)
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
        scopeDepth: row?.scopeDepth !== undefined ? Number(row.scopeDepth) : undefined,
        hasDocumentation: row?.hasDocumentation !== undefined ? Boolean(row.hasDocumentation) : undefined,
        language: row?.language ? String(row.language) : undefined,
        imports: row?.imports ? String(row.imports) : undefined,
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
    } = {},
  ): Promise<ReturnType<typeof mapRow>[]> {
    const limit = options.limit ?? 20

    let whereClause: string | undefined
    if (options.filters) {
      whereClause = buildWhereFromFilters(options.filters)
    } else if (options.where) {
      whereClause = buildWhere(options.where)
    }

    let searchBuilder = (collection as any).vectorSearch(vector).limit(limit)
    if (whereClause) searchBuilder = searchBuilder.where(whereClause)

    const rows: any[] = await searchBuilder.toArray()
    return rows.map(mapRow)
  }

  export async function search(
    collection: LanceTable,
    query: string,
    options: {
      limit?: number
      where?: Record<string, string> // Legacy format (kept for backward compatibility)
      filters?: SearchFilters // New structured filters
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
    const [queryEmbedding] = await Embeddings.embed(query, { taskType: "RETRIEVAL_QUERY" })

    // Build WHERE clause: prioritize structured filters, fall back to legacy where
    let whereClause: string | undefined
    if (options.filters) {
      whereClause = buildWhereFromFilters(options.filters)
    } else if (options.where) {
      whereClause = buildWhere(options.where)
    }

    // LanceDB returns rows with a `_distance` column for vector searches.
    let searchBuilder = (collection as any).vectorSearch(queryEmbedding).limit(limit)
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
        scopeDepth: r.scopeDepth !== undefined ? Number(r.scopeDepth) : undefined,
        hasDocumentation: r.hasDocumentation !== undefined ? Boolean(r.hasDocumentation) : undefined,
        language: r.language ? String(r.language) : undefined,
        imports: r.imports ? String(r.imports) : undefined,
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
    dbCache.delete(projectPath)
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
      await db.openTable(TABLE_NAME)
      return true
    } catch {
      return false
    }
  }
}
