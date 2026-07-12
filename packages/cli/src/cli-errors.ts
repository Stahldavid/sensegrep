export class CliUsageError extends Error {
  readonly code: string
  readonly phase: "arguments" | "execution"

  constructor(message: string, options: { code?: string; phase?: "arguments" | "execution" } = {}) {
    super(message)
    this.name = "CliUsageError"
    this.code = options.code ?? "INVALID_ARGUMENT"
    this.phase = options.phase ?? "arguments"
  }
}
