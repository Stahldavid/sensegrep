import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const cliPath = path.join(process.cwd(), "packages/cli/dist/main.js")
const itIfBuilt = existsSync(cliPath) ? it : it.skip

async function runCli(args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  })
}

describe("CLI JSON stdout contract", () => {
  let tempRoot: string | undefined

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  itIfBuilt("keeps detect-duplicates --json parseable while progress and warnings use stderr", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-json-output-"))
    await writeFile(
      path.join(tempRoot, "sample.ts"),
      "export function calculateTotal(value: number) {\n  return value + 1\n}\n",
    )

    const { stdout, stderr } = await runCli([
      "detect-duplicates",
      "--root",
      tempRoot,
      "--json",
      "--max-candidates",
      "10",
    ])

    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty("summary")
    expect(parsed).toHaveProperty("duplicates")
    expect(stderr).toContain("Detecting logical duplicates")
    expect(stdout).not.toContain("Detecting logical duplicates")
    expect(stdout).not.toContain("WARN")
  })

  itIfBuilt("can suppress human stderr logs for JSON duplicate detection", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-json-output-"))
    await writeFile(
      path.join(tempRoot, "sample.ts"),
      "export function calculateTotal(value: number) {\n  return value + 1\n}\n",
    )

    const { stdout, stderr } = await runCli([
      "detect-duplicates",
      "--root",
      tempRoot,
      "--json",
      "--log-format",
      "none",
      "--max-candidates",
      "10",
    ])

    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty("summary")
    expect(stderr).not.toContain("Detecting logical duplicates")
  })

  itIfBuilt("keeps status lightweight unless freshness verification is requested", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-status-output-"))

    const { stdout } = await runCli(["status", "--root", tempRoot])

    const parsed = JSON.parse(stdout)
    expect(parsed).toMatchObject({
      indexed: false,
      freshnessChecked: false,
      isStale: null,
    })
    expect(parsed).not.toHaveProperty("changed")
    expect(parsed).not.toHaveProperty("missing")
    expect(parsed).not.toHaveProperty("removed")
  })

  itIfBuilt("keeps simple JSON commands parseable without stderr noise", async () => {
    const { stdout, stderr } = await runCli(["semantic-kinds", "--json"])

    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed.semanticKinds)).toBe(true)
    expect(stderr).toBe("")
  })

  itIfBuilt("keeps languages --json parseable without human text", async () => {
    const { stdout, stderr } = await runCli(["languages", "--json"])

    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed.languages)).toBe(true)
    expect(parsed.capabilities).toHaveProperty("symbolTypes")
    expect(stderr).toBe("")
    expect(stdout).not.toContain("Supported languages")
  })

  itIfBuilt("selftest reports embedding provider, model, dimension, and credential guidance", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-selftest-output-"))
    await writeFile(path.join(tempRoot, "sample.ts"), "export function sample() {\n  return 1\n}\n")

    const { stdout } = await runCli(["selftest", "--root", tempRoot, "--json"], {
      env: {
        SENSEGREP_PROVIDER: "ollama",
        SENSEGREP_EMBED_MODEL: "qwen3-embedding:0.6b",
        SENSEGREP_EMBED_DIM: "1024",
        SENSEGREP_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      },
    })

    const parsed = JSON.parse(stdout)
    const embeddingCheck = parsed.checks.find((check: any) => check.name === "embeddings.config")
    expect(embeddingCheck).toMatchObject({
      ok: true,
      name: "embeddings.config",
    })
    expect(embeddingCheck.details).toMatchObject({
      provider: "ollama",
      embedModel: "qwen3-embedding:0.6b",
      embedDim: 1024,
      baseUrl: "http://127.0.0.1:11434",
      credentialsPresent: false,
    })
    expect(embeddingCheck.message).toContain("provider=ollama")
    expect(embeddingCheck.message).toContain("model=qwen3-embedding:0.6b")
    expect(embeddingCheck.message).toContain("dim=1024")
    expect(embeddingCheck.message).toContain("baseUrl=http://127.0.0.1:11434")
    expect(embeddingCheck.message).toContain("credentials=not-required")
  })

  itIfBuilt("selftest reports OpenAI-compatible endpoint details without leaking secrets", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-selftest-output-"))
    await writeFile(path.join(tempRoot, "sample.ts"), "export function sample() {\n  return 1\n}\n")

    const { stdout } = await runCli(["selftest", "--root", tempRoot, "--json"], {
      env: {
        SENSEGREP_PROVIDER: "openai",
        SENSEGREP_OPENAI_API_KEY: "test-secret-value",
        SENSEGREP_OPENAI_BASE_URL: "http://127.0.0.1:1234/v1",
        SENSEGREP_EMBED_MODEL: "local/jina-code",
        SENSEGREP_EMBED_DIM: "896",
      },
    })

    const parsed = JSON.parse(stdout)
    const embeddingCheck = parsed.checks.find((check: any) => check.name === "embeddings.config")
    expect(embeddingCheck.details).toMatchObject({
      provider: "openai",
      embedModel: "local/jina-code",
      embedDim: 896,
      baseUrl: "http://127.0.0.1:1234/v1",
      credentialsPresent: true,
    })
    expect(embeddingCheck.message).toContain("baseUrl=http://127.0.0.1:1234/v1")
    expect(embeddingCheck.message).toContain("credentials=present")
    expect(embeddingCheck.message).not.toContain("test-secret-value")
  })

  itIfBuilt("rejects invalid duplicate-detection numeric flags without stack traces", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-cli-validation-"))

    await expect(runCli(["detect-duplicates", "--root", tempRoot, "--threshold", "nope"])).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("--threshold must be a number between 0 and 1"),
    })

    await expect(runCli(["detect-duplicates", "--root", tempRoot, "--limit", "zero"])).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("--limit must be a positive integer"),
    })
  })

  itIfBuilt("rejects invalid duplicate-detection scope values", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "sensegrep-cli-validation-"))

    await expect(runCli(["detect-duplicates", "--root", tempRoot, "--scope", "function,typo"])).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("--scope must contain only function, method, or all"),
    })
  })
})
