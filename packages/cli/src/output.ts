export function writeStdoutLine(message = "") {
  process.stdout.write(`${message}\n`)
}

export function writeStderrLine(message = "") {
  process.stderr.write(`${message}\n`)
}

export function writeJson(payload: unknown) {
  writeStdoutLine(JSON.stringify(payload, null, 2))
}

export function createHumanLogger(input: { json?: boolean }) {
  return input.json ? writeStderrLine : writeStdoutLine
}
