import { afterEach, describe, expect, it, vi } from "vitest"
import { createHumanLogger, writeJson } from "./output.js"

describe("CLI output streams", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("writes JSON only to stdout", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    writeJson({ ok: true })

    expect(stdout).toHaveBeenCalledTimes(1)
    expect(stderr).not.toHaveBeenCalled()
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({ ok: true })
  })

  it("routes human logs to stderr in JSON mode", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    createHumanLogger({ json: true })("progress")

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith("progress\n")
  })

  it("routes human logs to stdout in text mode", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    createHumanLogger({ json: false })("progress")

    expect(stdout).toHaveBeenCalledWith("progress\n")
    expect(stderr).not.toHaveBeenCalled()
  })
})
