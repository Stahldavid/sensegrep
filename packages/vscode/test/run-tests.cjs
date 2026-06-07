const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { runTests } = require("@vscode/test-electron")

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..")
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sensegrep-vscode-"))
  fs.writeFileSync(
    path.join(workspacePath, "sample.ts"),
    "export function hello(name: string) { return `hello ${name}` }\n",
    "utf8",
  )

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, "suite", "index.cjs"),
    launchArgs: [
      workspacePath,
      "--disable-extensions",
      "--disable-workspace-trust",
    ],
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
