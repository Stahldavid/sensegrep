import { Log } from "../util/log.js"
import { TreeSitterChunking } from "./chunking-treesitter.js"
import { Chunking } from "./chunking.js"
import { Embeddings } from "./embeddings.js"
import { VectorStore } from "./lancedb.js"
import * as fs from "fs/promises"
import * as path from "path"

const log = Log.create({ service: "semantic.duplicate-detector" })

export namespace DuplicateDetector {
  export enum DuplicateLevel {
    EXACT = "exact",       // 0.98-1.0: Código praticamente idêntico
    HIGH = "high",         // 0.90-0.97: Lógica muito similar
    MEDIUM = "medium",     // 0.80-0.89: Lógica parecida
    LOW = "low",           // 0.70-0.79: Alguma similaridade
  }

  export interface CodeInstance {
    file: string
    symbol: string
    content: string
    startLine: number
    endLine: number
    complexity?: number
    symbolType?: string
  }

  export interface DuplicateGroup {
    level: DuplicateLevel
    similarity: number
    instances: CodeInstance[]
    impact: {
      totalLines: number
      complexity: number
      fileCount: number
      estimatedSavings: number
      score: number
    }
    category?: string
    isLikelyOk: boolean
  }

  export interface DetectOptions {
    path: string
    thresholds?: {
      exact?: number
      high?: number
      medium?: number
      low?: number
    }
    scopeFilter?: Array<"function" | "class" | "method">
    ignoreTests?: boolean
    ignoreAcceptablePatterns?: boolean
    normalizeIdentifiers?: boolean
    minLines?: number
    minComplexity?: number
    rankByImpact?: boolean
    crossFileOnly?: boolean
    onlyExported?: boolean
    excludePattern?: string
  }

  export interface DetectResult {
    summary: {
      totalDuplicates: number
      byLevel: Record<DuplicateLevel, number>
      totalSavings: number
      filesAffected: number
    }
    duplicates: DuplicateGroup[]
    acceptableDuplicates?: DuplicateGroup[]
  }

  // Padrões aceitáveis de duplicação
  const ACCEPTABLE_PATTERNS = [
    {
      category: "validation",
      maxLines: 5,
      maxComplexity: 2,
      pattern: /^(validate|check|is|has)\w*/i,
    },
    {
      category: "guard",
      maxLines: 3,
      maxComplexity: 1,
      pattern: /^(if\s*\(!\w+\)|if\s*\(\w+\s*===?\s*null)/,
    },
  ]

  const IDENTIFIER_REGEX = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g
  const RESERVED_WORDS = new Set([
    "abstract",
    "any",
    "as",
    "asserts",
    "async",
    "await",
    "bigint",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "instanceof",
    "interface",
    "is",
    "keyof",
    "let",
    "module",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "object",
    "of",
    "package",
    "private",
    "protected",
    "public",
    "readonly",
    "require",
    "return",
    "set",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "$NUM",
    "$STR",
    "$ID",
  ])

  /**
   * Normalizar código para comparação (substituir identificadores por placeholders)
   */
  function normalizeCode(content: string): string {
    // Substituir nomes de variáveis/parâmetros por placeholders genéricos
    // mantendo a estrutura do código

    let normalized = content

    // Substituir literais numéricos
    normalized = normalized.replace(/\b\d+\.?\d*\b/g, "$NUM")

    // Substituir strings literais
    normalized = normalized.replace(/"[^"]*"/g, '"$STR"')
    normalized = normalized.replace(/'[^']*'/g, "'$STR'")
    normalized = normalized.replace(/`[^`]*`/g, "`$STR`")

    // Remover comentários
    normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, "")
    normalized = normalized.replace(/\/\/.*/g, "")

    // Normalizar identificadores (variáveis, funções, etc.)
    normalized = normalized.replace(IDENTIFIER_REGEX, (match) =>
      RESERVED_WORDS.has(match) ? match : "$ID",
    )

    // Normalizar whitespace
    normalized = normalized.replace(/\s+/g, " ").trim()

    return normalized
  }

  /**
   * Extrair definições de código (functions, classes, methods)
   */
  async function extractDefinitions(
    rootPath: string,
    scopeFilter?: Array<"function" | "class" | "method">,
  ): Promise<CodeInstance[]> {
    const definitions: CodeInstance[] = []
    const files = await getCodeFiles(rootPath)

    log.info("extracting definitions", { files: files.length, scopeFilter })

    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8")
        const chunks = await TreeSitterChunking.chunk(content, file)

        for (const chunk of chunks) {
          // Filtrar apenas definições (não chamadas)
          if (!chunk.symbolType) continue

          // REJECT signature chunks explicitly (namespaces, classes, interfaces, etc)
          // These are declarations, not executable code
          const signatureTypes = ["namespace", "class", "interface", "type", "enum", "variable"]
          if (signatureTypes.includes(chunk.symbolType)) {
            log.debug("skipping signature chunk", { type: chunk.symbolType, symbol: chunk.symbolName })
            continue
          }

          // ONLY accept actual executable code
          const acceptableTypes = ["function", "method"]

          // Aplicar filtro de scope
          if (scopeFilter && scopeFilter.length > 0) {
            // Use symbolType directly (no mapping needed)
            if (!scopeFilter.includes(chunk.symbolType as any)) continue
          } else {
            // Default: only functions and methods
            if (!acceptableTypes.includes(chunk.symbolType)) continue
          }

          definitions.push({
            file,
            symbol: chunk.symbolName || "anonymous",
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            complexity: chunk.complexity,
            symbolType: chunk.symbolType,
          })
        }
      } catch (error) {
        log.warn("failed to extract definitions", { file, error: String(error) })
      }
    }

    log.info("definitions extracted", { count: definitions.length })
    return definitions
  }

  /**
   * Obter arquivos de código no diretório
   */
  async function getCodeFiles(rootPath: string): Promise<string[]> {
    const files: string[] = []

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Ignorar node_modules, .git, dist, etc
          if (["node_modules", ".git", "dist", "build", ".next"].includes(entry.name)) {
            continue
          }
          await walk(fullPath)
        } else if (entry.isFile()) {
          // Aceitar apenas arquivos de código suportados
          if (TreeSitterChunking.isSupported(fullPath)) {
            files.push(fullPath)
          }
        }
      }
    }

    await walk(rootPath)
    return files
  }

  /**
   * Calcular similaridade entre dois vetores (cosine similarity)
   */
  function cosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0
    let norm1 = 0
    let norm2 = 0

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i]
      norm1 += vec1[i] * vec1[i]
      norm2 += vec2[i] * vec2[i]
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2))
  }

  const TOKENIZE_REGEX = /[A-Za-z_$][A-Za-z0-9_$]*|\d+|[^\s]/g

  function tokenize(text: string): string[] {
    const normalized = text.replace(/\s+/g, " ").trim()
    if (!normalized) return []
    return normalized.match(TOKENIZE_REGEX) ?? []
  }

  function buildTokenShingles(tokens: string[], size: number): Set<string> {
    const set = new Set<string>()
    if (tokens.length < size) return set
    for (let i = 0; i <= tokens.length - size; i++) {
      set.add(tokens.slice(i, i + size).join(" "))
    }
    return set
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    let intersection = 0
    for (const item of a) {
      if (b.has(item)) intersection++
    }
    const union = a.size + b.size - intersection
    if (union === 0) return 0
    return intersection / union
  }

  function textSimilarity(a: string, b: string): number | null {
    if (!a || !b) return null
    if (a === b) return 1
    const tokensA = tokenize(a)
    const tokensB = tokenize(b)
    if (tokensA.length === 0 || tokensB.length === 0) return null
    const lenPenalty = Math.min(tokensA.length, tokensB.length) / Math.max(tokensA.length, tokensB.length)
    const shingleSize = 2
    const shinglesA = buildTokenShingles(tokensA, shingleSize)
    const shinglesB = buildTokenShingles(tokensB, shingleSize)
    const jaccard = jaccardSimilarity(shinglesA, shinglesB)
    return jaccard * Math.sqrt(lenPenalty)
  }

  /**
   * Determinar nível de duplicação baseado em similaridade
   */
  function getDuplicateLevel(
    similarity: number,
    thresholds: { exact: number; high: number; medium: number; low: number },
  ): DuplicateLevel | null {
    if (similarity >= thresholds.exact) return DuplicateLevel.EXACT
    if (similarity >= thresholds.high) return DuplicateLevel.HIGH
    if (similarity >= thresholds.medium) return DuplicateLevel.MEDIUM
    if (similarity >= thresholds.low) return DuplicateLevel.LOW
    return null
  }

  /**
   * Calcular impacto de um grupo de duplicatas
   */
  function calculateImpact(group: DuplicateGroup): DuplicateGroup["impact"] {
    const totalLines = group.instances.reduce((sum, inst) => sum + (inst.endLine - inst.startLine + 1), 0)
    const avgComplexity = group.instances.reduce((sum, inst) => sum + (inst.complexity || 1), 0) / group.instances.length
    const fileCount = new Set(group.instances.map((i) => i.file)).size

    // Savings = todas as linhas duplicadas menos a original
    const estimatedSavings = totalLines - (group.instances[0].endLine - group.instances[0].startLine + 1)

    // Score = impacto total (maior = mais importante refatorar)
    const score = totalLines * avgComplexity * fileCount

    return {
      totalLines,
      complexity: avgComplexity,
      fileCount,
      estimatedSavings,
      score,
    }
  }

  /**
   * Verificar se duplicata deve ser ignorada (padrão aceitável)
   */
  function shouldFlag(group: DuplicateGroup): boolean {
    const categories = new Set<string>()

    for (const instance of group.instances) {
      const lines = instance.endLine - instance.startLine + 1
      let matched: string | null = null

      for (const pattern of ACCEPTABLE_PATTERNS) {
        if (lines <= pattern.maxLines && (instance.complexity || 0) <= pattern.maxComplexity) {
          if (pattern.pattern.test(instance.symbol) || pattern.pattern.test(instance.content)) {
            matched = pattern.category
            break
          }
        }
      }

      if (!matched) {
        return true
      }

      categories.add(matched)
    }

    if (categories.size > 0) {
      const [category] = Array.from(categories)
      group.category = categories.size === 1 ? category : "acceptable"
      group.isLikelyOk = true
      log.debug("acceptable pattern detected", {
        category: group.category,
        instances: group.instances.length,
      })
      return false
    }

    return true
  }

  /**
   * Detectar duplicatas lógicas
   */
  export async function detect(options: DetectOptions): Promise<DetectResult> {
    const startTime = Date.now()

    // Defaults
    const thresholds = {
      exact: options.thresholds?.exact ?? 0.98,
      high: options.thresholds?.high ?? 0.90,
      medium: options.thresholds?.medium ?? 0.80,
      low: options.thresholds?.low ?? 0.70,
    }

    const normalizeIdentifiers = options.normalizeIdentifiers ?? true
    const ignoreAcceptablePatterns = options.ignoreAcceptablePatterns ?? false
    const minLines = options.minLines ?? 3
    const minComplexity = options.minComplexity ?? 0

    const resolvedPath = await fs.realpath(options.path).catch(() => path.resolve(options.path))

    log.info("detecting logical duplicates", { path: resolvedPath, thresholds, normalizeIdentifiers })

    const scopeFilter = options.scopeFilter

    log.info("detecting logical duplicates (vectorstore)", {
      path: resolvedPath,
      thresholds,
      normalizeIdentifiers,
    })

    const meta = await VectorStore.readIndexMeta(resolvedPath)
    if (!meta || !meta.embeddings) {
      log.warn("index metadata not found; run sensegrep index first", { path: resolvedPath })
      return {
        summary: {
          totalDuplicates: 0,
          byLevel: {
            [DuplicateLevel.EXACT]: 0,
            [DuplicateLevel.HIGH]: 0,
            [DuplicateLevel.MEDIUM]: 0,
            [DuplicateLevel.LOW]: 0,
          },
          totalSavings: 0,
          filesAffected: 0,
        },
        duplicates: [],
      }
    }

    const collection = await VectorStore.getCollectionUnsafe(resolvedPath, meta.embeddings.dimension)

    const filters: VectorStore.SearchFilters = { all: [] }
    if (scopeFilter === undefined) {
      filters.all!.push({ key: "symbolType", operator: "in", value: ["function", "method"] })
    } else if (scopeFilter.length > 0) {
      filters.all!.push({ key: "symbolType", operator: "in", value: scopeFilter })
    }
    if (options.onlyExported) {
      filters.all!.push({ key: "isExported", operator: "equals", value: true })
    }
    if (minComplexity > 0) {
      filters.all!.push({ key: "complexity", operator: "greater_or_equal", value: minComplexity })
    }

    const rows = await VectorStore.listDocuments(collection, {
      filters,
      columns: [
        "id",
        "content",
        "content_raw",
        "file",
        "startLine",
        "endLine",
        "symbolName",
        "symbolType",
        "complexity",
        "isExported",
        "parentScope",
        "vector",
      ],
    })

    const excludeRegex = options.excludePattern ? new RegExp(options.excludePattern) : null
    const candidates = rows
      .filter((row) => Array.isArray(row.vector) && row.vector.length > 0)
      .map((row) => {
        const startLine = Number(row.metadata.startLine ?? 0)
        const endLine = Number(row.metadata.endLine ?? 0)
        const content = String(row.content ?? "")
        const rawContent = String((row as any).contentRaw ?? "")
        const normalized = normalizeIdentifiers ? normalizeCode(rawContent || content) : undefined
        return {
          id: row.id,
          file: String(row.metadata.file ?? ""),
          symbol: String(row.metadata.symbolName ?? "anonymous"),
          content,
          rawContent,
          startLine,
          endLine,
          complexity: typeof row.metadata.complexity === "number" ? row.metadata.complexity : undefined,
          symbolType: row.metadata.symbolType ? String(row.metadata.symbolType) : undefined,
          vector: row.vector as number[],
          normalized,
        } as CodeInstance & { id: string; vector: number[]; normalized?: string; rawContent: string }
      })
      .filter((c) => {
        if (options.ignoreTests) {
          if (c.file.includes(".test.") || c.file.includes(".spec.") || c.file.includes("__tests__")) {
            return false
          }
        }
        if (excludeRegex && excludeRegex.test(c.symbol)) return false
        const lines = c.endLine - c.startLine + 1
        if (lines < minLines) return false
        if ((c.complexity ?? 0) < minComplexity) return false
        return true
      })

    log.info("candidates after filtering", { count: candidates.length })

    if (candidates.length === 0) {
      return {
        summary: {
          totalDuplicates: 0,
          byLevel: {
            [DuplicateLevel.EXACT]: 0,
            [DuplicateLevel.HIGH]: 0,
            [DuplicateLevel.MEDIUM]: 0,
            [DuplicateLevel.LOW]: 0,
          },
          totalSavings: 0,
          filesAffected: 0,
        },
        duplicates: [],
      }
    }

    const candidateById = new Map(candidates.map((c) => [c.id, c]))
    const candidateIds = new Set(candidates.map((c) => c.id))
    const pairs = new Map<string, { a: string; b: string; similarity: number }>()
    const maxNeighbors = Math.min(30, Math.max(5, candidates.length))

    for (const candidate of candidates) {
      const neighbors = await VectorStore.searchByVector(collection, candidate.vector, {
        limit: maxNeighbors,
        filters,
      })

      for (const neighbor of neighbors) {
        if (neighbor.id === candidate.id) continue
        if (!candidateIds.has(neighbor.id)) continue
        const other = candidateById.get(neighbor.id)
        if (!other) continue
        if (options.crossFileOnly && other.file === candidate.file) continue

        const vectorSimilarity = 1 - neighbor.distance
        let similarity = vectorSimilarity
        const rawA = candidate.rawContent || candidate.content
        const rawB = other.rawContent || other.content
        const normA = normalizeIdentifiers ? candidate.normalized ?? normalizeCode(rawA) : rawA
        const normB = normalizeIdentifiers ? other.normalized ?? normalizeCode(rawB) : rawB
        if (normalizeIdentifiers && normA && normB && normA === normB) {
          similarity = 1
        } else {
          const textSim = textSimilarity(normA, normB)
          if (textSim !== null) {
            if (textSim < 0.1) continue
            similarity = 0.8 * vectorSimilarity + 0.2 * textSim
          }
        }

        const level = getDuplicateLevel(similarity, thresholds)
        if (!level) continue

        const key = candidate.id < other.id ? `${candidate.id}::${other.id}` : `${other.id}::${candidate.id}`
        const existing = pairs.get(key)
        if (!existing || similarity > existing.similarity) {
          pairs.set(key, { a: candidate.id, b: other.id, similarity })
        }
      }
    }

    if (pairs.size === 0) {
      return {
        summary: {
          totalDuplicates: 0,
          byLevel: {
            [DuplicateLevel.EXACT]: 0,
            [DuplicateLevel.HIGH]: 0,
            [DuplicateLevel.MEDIUM]: 0,
            [DuplicateLevel.LOW]: 0,
          },
          totalSavings: 0,
          filesAffected: 0,
        },
        duplicates: [],
      }
    }

    class UnionFind {
      parent: Map<string, string>
      constructor(values: string[]) {
        this.parent = new Map(values.map((v) => [v, v]))
      }
      find(x: string): string {
        const p = this.parent.get(x)
        if (!p || p === x) return x
        const root = this.find(p)
        this.parent.set(x, root)
        return root
      }
      union(a: string, b: string) {
        const ra = this.find(a)
        const rb = this.find(b)
        if (ra !== rb) this.parent.set(ra, rb)
      }
    }

    const uf = new UnionFind(Array.from(candidateIds))
    for (const pair of pairs.values()) {
      uf.union(pair.a, pair.b)
    }

    const groups = new Map<string, { ids: string[]; maxSim: number }>()
    for (const pair of pairs.values()) {
      const root = uf.find(pair.a)
      const group = groups.get(root) ?? { ids: [], maxSim: 0 }
      group.maxSim = Math.max(group.maxSim, pair.similarity)
      groups.set(root, group)
    }

    // Populate ids per group
    for (const id of candidateIds) {
      const root = uf.find(id)
      const group = groups.get(root)
      if (!group) continue
      group.ids.push(id)
    }

    let duplicates: DuplicateGroup[] = []
    for (const group of groups.values()) {
      if (group.ids.length < 2) continue
      const instances = group.ids
        .map((id) => candidateById.get(id))
        .filter(Boolean)
        .map((c) => ({
          file: c!.file,
          symbol: c!.symbol,
          content: c!.content,
          startLine: c!.startLine,
          endLine: c!.endLine,
          complexity: c!.complexity,
          symbolType: c!.symbolType,
        }))

      const similarity = group.maxSim
      const level = getDuplicateLevel(similarity, thresholds) ?? DuplicateLevel.LOW
      duplicates.push({
        level,
        similarity,
        instances,
        impact: {} as any,
        isLikelyOk: false,
      })
    }

    log.info("duplicates found", { count: duplicates.length })

    // Calculate impact
    for (const dup of duplicates) {
      dup.impact = calculateImpact(dup)
    }

    // Filter acceptable patterns
    let acceptableDuplicates: DuplicateGroup[] = []
    if (!ignoreAcceptablePatterns) {
      const flagged: DuplicateGroup[] = []
      for (const dup of duplicates) {
        if (shouldFlag(dup)) {
          flagged.push(dup)
        } else {
          acceptableDuplicates.push(dup)
        }
      }
      duplicates = flagged
    }

    // Rank by impact
    if (options.rankByImpact) {
      duplicates.sort((a, b) => b.impact.score - a.impact.score)
    }

    const byLevel: Record<DuplicateLevel, number> = {
      [DuplicateLevel.EXACT]: 0,
      [DuplicateLevel.HIGH]: 0,
      [DuplicateLevel.MEDIUM]: 0,
      [DuplicateLevel.LOW]: 0,
    }

    for (const dup of duplicates) {
      byLevel[dup.level]++
    }

    const totalSavings = duplicates.reduce((sum, dup) => sum + dup.impact.estimatedSavings, 0)
    const filesAffected = new Set(duplicates.flatMap((d) => d.instances.map((i) => i.file))).size

    const elapsed = Date.now() - startTime
    log.info("detection complete", {
      duplicates: duplicates.length,
      acceptable: acceptableDuplicates.length,
      elapsed: `${elapsed}ms`,
    })

    return {
      summary: {
        totalDuplicates: duplicates.length,
        byLevel,
        totalSavings,
        filesAffected,
      },
      duplicates,
      acceptableDuplicates: acceptableDuplicates.length > 0 ? acceptableDuplicates : undefined,
    }
  }
}
