let corePromise: Promise<any> | null = null
let toolPromise: Promise<any> | null = null

async function loadCore() {
  if (!corePromise) {
    console.error("[MCP] Loading @sensegrep/core...")
    corePromise = import("@sensegrep/core")
  }
  return corePromise
}

async function loadTool() {
  const core = await loadCore()
  if (!toolPromise) toolPromise = core.SenseGrepTool.init()
  const tool = await toolPromise
  return { core, tool }
}

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id?: number | string | null
  method: string
  params?: any
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: number | string | null
  result?: any
  error?: { code: number; message: string; data?: any }
}

type IndexResult = {
  mode?: string
  files?: number
  chunks?: number
  skipped?: number
  removed?: number
  duration?: number
}

function isIncremental(result: IndexResult): result is IndexResult & { mode: "incremental" } {
  return (result as any).mode === "incremental"
}

const toolSchemas = [
  {
    name: "sensegrep.search",
    description: "Semantic + structural code search with optional regex filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        pattern: { type: "string" },
        limit: { type: "number" },
        include: { type: "string" },
        symbolType: {
          type: "string",
          enum: ["function", "class", "method", "interface", "type", "variable", "namespace", "enum"],
        },
        isExported: { type: "boolean" },
        minComplexity: { type: "number" },
        maxComplexity: { type: "number" },
        hasDocumentation: { type: "boolean" },
        language: { type: "string", enum: ["typescript", "javascript", "tsx", "jsx"] },
        parentScope: { type: "string" },
        rerank: { type: "boolean" },
        embedModel: { type: "string" },
        embedDim: { type: "number" },
        rerankModel: { type: "string" },
        device: { type: "string" },
        provider: { type: "string" },
        rootDir: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "sensegrep.index",
    description: "Create or update a semantic index for the given root directory.",
    inputSchema: {
      type: "object",
      properties: {
        rootDir: { type: "string" },
        full: { type: "boolean" },
        embedModel: { type: "string" },
        embedDim: { type: "number" },
        rerankModel: { type: "string" },
        device: { type: "string" },
        provider: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "sensegrep.stats",
    description: "Get index stats for the given root directory.",
    inputSchema: {
      type: "object",
      properties: {
        rootDir: { type: "string" },
      },
      additionalProperties: false,
    },
  },
]

function send(response: JsonRpcResponse) {
  const json = JSON.stringify(response)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  process.stdout.write(header + json)
}

function resultText(text: string, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    meta,
  }
}

async function handleRequest(req: JsonRpcRequest) {
  const id = req.id ?? null
  console.error(`[MCP] Received request: ${req.method}`)

  if (req.method === "initialize") {
    console.error("[MCP] Sending initialize response...")
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "sensegrep", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    })
    console.error("[MCP] Initialize response sent")
    return
  }

  if (req.method === "notifications/initialized") {
    console.error("[MCP] Received initialized notification - handshake complete")
    return
  }

  if (req.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: toolSchemas },
    })
    return
  }

  if (req.method === "tools/call") {
    const params = req.params || {}
    const name = params.name
    const args = params.arguments || {}
    const rootDir = args.rootDir || process.env.SENSEGREP_ROOT || process.cwd()
    const provider = args.provider === "local" || args.provider === "gemini" ? args.provider : undefined
    const embedOverrides: Record<string, unknown> = {
      ...(args.embedModel ? { embedModel: String(args.embedModel) } : {}),
      ...(args.embedDim ? { embedDim: Number(args.embedDim) } : {}),
      ...(args.rerankModel ? { rerankModel: String(args.rerankModel) } : {}),
      ...(args.device ? { device: String(args.device) } : {}),
      ...(provider ? { provider } : {}),
    }

    try {
      if (name === "sensegrep.search") {
        const { core, tool } = await loadTool()
        const { rootDir: _root, ...toolArgs } = args
        const { Instance, Embeddings } = core
        const withOverrides = Object.keys(embedOverrides).length
          ? (fn: () => Promise<any>) => Embeddings.withConfig(embedOverrides as any, fn)
          : (fn: () => Promise<any>) => fn()
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
          }),
        )
        send({
          jsonrpc: "2.0",
          id,
          result: resultText(res.output, { title: res.title, metadata: res.metadata }),
        })
        return
      }

      if (name === "sensegrep.index") {
        const full = args.full === true
        const { core } = await loadTool()
        const { Indexer, Instance, Embeddings } = core
        const withOverrides = Object.keys(embedOverrides).length
          ? (fn: () => Promise<any>) => Embeddings.withConfig(embedOverrides as any, fn)
          : (fn: () => Promise<any>) => fn()
        const result = (await withOverrides(() =>
          Instance.provide({
            directory: rootDir,
            fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
          }),
        )) as any
        send({
          jsonrpc: "2.0",
          id,
          result: resultText(
            (() => {
              const files = result.files ?? 0
              const chunks = result.chunks ?? 0
              const skipped = result.skipped ?? 0
              const removed = result.removed ?? 0
              const durationMs = result.duration ?? 0
              const duration = (durationMs / 1000).toFixed(1)
              return isIncremental(result)
                ? `Indexed ${files} files (${chunks} chunks), skipped ${skipped}, removed ${removed} in ${duration}s`
                : `Indexed ${files} files (${chunks} chunks) in ${duration}s`
            })(),
          ),
        })
        return
      }

      if (name === "sensegrep.stats") {
        const { core } = await loadTool()
        const { Indexer, Instance } = core
        const stats = await Instance.provide({
          directory: rootDir,
          fn: () => Indexer.getStats(),
        })
        send({
          jsonrpc: "2.0",
          id,
          result: resultText(JSON.stringify(stats, null, 2)),
        })
        return
      }

      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${name}` },
      })
      return
    } catch (error: any) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: error?.message || "Internal error" },
      })
      return
    }
  }

  if (req.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    })
  }
}

let buffer = Buffer.alloc(0)
let inputLog: any[] = []

console.error("[MCP] Server started, waiting for input...")

process.stdin.on("data", (chunk) => {
  console.error(`[MCP] Received ${chunk.length} bytes`)
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
  inputLog.push({ time: Date.now(), bytes: chunk.length, hex: chunk.toString("hex").substring(0, 100) })
  console.error(`[MCP] Buffer size: ${buffer.length}, first 200 chars: ${buffer.toString("utf8", 0, Math.min(200, buffer.length))}`)

  while (true) {
    // Check if buffer starts with JSON (no Content-Length header)
    const bufStr = buffer.toString("utf8")
    if (bufStr.trimStart().startsWith("{")) {
      console.error(`[MCP] Detected JSON without Content-Length header, trying to parse...`)
      try {
        // Try to find complete JSON object
        let depth = 0
        let inString = false
        let escape = false
        let jsonEnd = -1

        for (let i = 0; i < bufStr.length; i++) {
          const char = bufStr[i]
          if (escape) {
            escape = false
            continue
          }
          if (char === '\\') {
            escape = true
            continue
          }
          if (char === '"' && !escape) {
            inString = !inString
            continue
          }
          if (!inString) {
            if (char === '{') depth++
            if (char === '}') {
              depth--
              if (depth === 0) {
                jsonEnd = i + 1
                break
              }
            }
          }
        }

        if (jsonEnd > 0) {
          const jsonStr = bufStr.substring(0, jsonEnd)
          console.error(`[MCP] Found complete JSON of ${jsonEnd} bytes`)
          const req = JSON.parse(jsonStr)
          console.error(`[MCP] Parsed JSON-RPC request`)
          buffer = buffer.slice(jsonEnd)
          void handleRequest(req)
          continue
        } else {
          console.error(`[MCP] Incomplete JSON object, waiting for more data`)
          break
        }
      } catch (err) {
        console.error(`[MCP] Failed to parse JSON: ${err}`)
        break
      }
    }

    // Standard Content-Length protocol
    let headerEnd = buffer.indexOf("\r\n\r\n")
    let headerSepLength = 4
    if (headerEnd === -1) {
      headerEnd = buffer.indexOf("\n\n")
      headerSepLength = 2
    }
    if (headerEnd === -1) {
      console.error(`[MCP] No header end found, waiting for more data`)
      break
    }
    const header = buffer.slice(0, headerEnd).toString("utf8")
    console.error(`[MCP] Header: ${header}`)
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      console.error(`[MCP] No Content-Length found in header, skipping`)
      buffer = buffer.slice(headerEnd + headerSepLength)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + headerSepLength
    const bodyEnd = bodyStart + length
    console.error(`[MCP] Expected body length: ${length}, buffer has: ${buffer.length}, need: ${bodyEnd}`)
    if (buffer.length < bodyEnd) {
      console.error(`[MCP] Incomplete message, waiting for more data`)
      break
    }
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8")
    console.error(`[MCP] Body: ${body}`)
    buffer = buffer.slice(bodyEnd)
    try {
      const req = JSON.parse(body)
      console.error(`[MCP] Parsed JSON-RPC request`)
      void handleRequest(req)
    } catch (err) {
      console.error(`[MCP] Failed to parse JSON: ${err}`)
    }
  }
})
