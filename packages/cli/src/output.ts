export function writeStdoutLine(message = "") {
  process.stdout.write(`${message}\n`)
}

export function writeStderrLine(message = "") {
  process.stderr.write(`${message}\n`)
}

let prettyJson = false

export function configureJsonOutput(options: { pretty?: boolean }) {
  prettyJson = options.pretty === true
}

export function isPrettyJson(): boolean {
  return prettyJson
}

export function serializeJson(payload: unknown, pretty = prettyJson): string {
  return `${JSON.stringify(payload, null, pretty ? 2 : undefined)}\n`
}

export function writeJson(payload: unknown) {
  process.stdout.write(serializeJson(payload))
}

export function createHumanLogger(input: { json?: boolean }) {
  return input.json ? writeStderrLine : writeStdoutLine
}
