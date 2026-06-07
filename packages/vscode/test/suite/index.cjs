const assert = require("node:assert")
const vscode = require("vscode")

async function run() {
  const extension = vscode.extensions.all.find(
    (item) => item.packageJSON?.name === "sensegrep" && item.packageJSON?.publisher === "sensegrep",
  )
  assert.ok(extension, "Sensegrep extension was not found in the Extension Development Host")
  await extension.activate()

  const requiredCommands = [
    "sensegrep.search",
    "sensegrep.survey",
    "sensegrep.cluster",
    "sensegrep.detectDuplicates",
    "sensegrep.indexProject",
  ]
  const commands = await vscode.commands.getCommands(true)
  for (const command of requiredCommands) {
    assert.ok(commands.includes(command), `Missing command: ${command}`)
  }

  const config = vscode.workspace.getConfiguration("sensegrep")
  assert.strictEqual(config.get("embeddings.provider"), "config")
}

module.exports = { run }
