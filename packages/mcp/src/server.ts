import { SenseGrepTool, Indexer, Instance } from "@sensegrep/core"

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

type IndexResult =
  | Awaited<ReturnType<typeof Indexer.indexProject>>
  | Awaited<ReturnType<typeof Indexer.indexProjectIncremental>>

function isIncremental(
  result: IndexResult,
): result is Awaited<ReturnType<typeof Indexer.indexProjectIncremental>> {
  return (result as any).mode === "incremental"
}

const toolPromise = SenseGrepTool.init()

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

  if (req.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "sensegrep", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    })
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

    try {
      if (name === "sensegrep.search") {
        const tool = await toolPromise
        const { rootDir: _root, ...toolArgs } = args
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
        })
        send({
          jsonrpc: "2.0",
          id,
          result: resultText(res.output, { title: res.title, metadata: res.metadata }),
        })
        return
      }

      if (name === "sensegrep.index") {
        const full = args.full === true
        const result = await Instance.provide({
          directory: rootDir,
          fn: () => (full ? Indexer.indexProject() : Indexer.indexProjectIncremental()),
        })
        send({
          jsonrpc: "2.0",
          id,
          result: resultText(
            isIncremental(result)
              ? `Indexed ${result.files} files (${result.chunks} chunks), skipped ${result.skipped}, removed ${result.removed} in ${(
                  result.duration / 1000
                ).toFixed(1)}s`
              : `Indexed ${result.files} files (${result.chunks} chunks) in ${(result.duration / 1000).toFixed(1)}s`,
          ),
        })
        return
      }

      if (name === "sensegrep.stats") {
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

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd === -1) break
    const header = buffer.slice(0, headerEnd).toString("utf8")
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) break
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8")
    buffer = buffer.slice(bodyEnd)
    try {
      const req = JSON.parse(body)
      void handleRequest(req)
    } catch {
      // ignore malformed JSON
    }
  }
})
