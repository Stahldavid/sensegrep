// Local stdio/TCP transport for a loopback-only WSL socat listener.
// Run with Windows Node; destination is fixed to the local Ollama service.
const net = require('node:net')
const socket = net.connect({ host: '127.0.0.1', port: 11434 })
socket.setTimeout(600_000, () => socket.destroy(new Error('Local Ollama transport timed out')))
socket.on('error', () => { process.stderr.write('Local Windows Ollama connection failed\n'); process.exitCode = 1 })
socket.on('close', () => process.exit(process.exitCode || 0))
process.stdin.on('error', () => socket.destroy())
process.stdout.on('error', () => socket.destroy())
process.stdin.pipe(socket)
socket.pipe(process.stdout)
