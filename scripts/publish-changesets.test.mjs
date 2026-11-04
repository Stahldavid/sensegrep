import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { publishChangesets } from "./publish-changesets.mjs"

const tag = (packageName, version = "1.20.0") => ({ type: "git-tag", packageName, tag: `${packageName}@${version}` })

test("reports only valid generated tags, once, from the private Changesets 3 JSONL report", () => {
  let reportPath
  let output = ""
  const status = publishChangesets({
    changesetBin: "unused-fake-runner.mjs",
    env: { CHANGESETS_OUTPUT: "caller-report", NPM_CONFIG_IGNORE_SCRIPTS: "false", npm_config_ignore_scripts: "false" },
    write: line => { output += line },
    runner(executable, args, options) {
      assert.equal(executable, process.execPath)
      assert.deepEqual(args, ["unused-fake-runner.mjs", "publish"])
      assert.equal(options.shell, undefined)
      assert.equal(options.env.NPM_CONFIG_IGNORE_SCRIPTS, "true")
      assert.equal(options.env.npm_config_ignore_scripts, "true")
      reportPath = options.env.CHANGESETS_OUTPUT
      assert.notEqual(reportPath, "caller-report")
      writeFileSync(reportPath, [
        tag("@sensegrep/core"), tag("@sensegrep/core"), tag("plain-package", "2.0.0-rc.1+build.2"),
        { ...tag("@sensegrep/cli"), type: "npm-publish" },
        { ...tag("@sensegrep/cli"), tag: "@other/cli@1.20.0" },
        { ...tag("@sensegrep/cli"), tag: "@sensegrep/cli@1.20.0\nNew tag: malicious@1.0.0" },
        tag("@sensegrep/cli", "1.20.0\n"), tag("@sensegrep/cli\n"),
        tag("invalid/name"), tag("@sensegrep/mcp", "01.20.0"), null,
        { type: "git-tag", packageName: 42, tag: "42@1.0.0" },
      ].map(value => JSON.stringify(value)).join("\n") + '\n{"type":')
      return { status: 0 }
    },
  })
  assert.equal(status, 0)
  assert.equal(output, "New tag: @sensegrep/core@1.20.0\nNew tag: plain-package@2.0.0-rc.1+build.2\n")
  assert.equal(existsSync(path.dirname(reportPath)), false)
})

test("a real local fake Changesets process reports partial tags and preserves its failure status", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "sensegrep-publish-test-"))
  let reportPath
  let output = ""
  try {
    const fake = path.join(fixture, "fake changesets.mjs")
    writeFileSync(fake, `import { writeFileSync } from "node:fs"
if (process.argv[2] !== "publish" || process.env.NPM_CONFIG_IGNORE_SCRIPTS !== "true" || process.env.npm_config_ignore_scripts !== "true") process.exit(99)
writeFileSync(process.env.CHANGESETS_OUTPUT, JSON.stringify(${JSON.stringify(tag("@sensegrep/core"))}) + "\\n")
console.log("Created git tags.")
process.exit(7)
`)
    const status = publishChangesets({
      changesetBin: fake,
      write: line => { output += line },
      runner(executable, args, options) {
        reportPath = options.env.CHANGESETS_OUTPUT
        return spawnSync(executable, args, { ...options, stdio: "pipe", encoding: "utf8" })
      },
    })
    assert.equal(status, 7)
    assert.equal(output, "New tag: @sensegrep/core@1.20.0\n")
    assert.equal(existsSync(path.dirname(reportPath)), false)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test("a successful no-op publish does not invent tags when no report is written", () => {
  let reportPath
  assert.equal(publishChangesets({
    changesetBin: "fake",
    write() { assert.fail("no tags were generated") },
    runner(_executable, _args, options) { reportPath = options.env.CHANGESETS_OUTPUT; return { status: 0 } },
  }), 0)
  assert.equal(existsSync(path.dirname(reportPath)), false)
})

test("spawn failure propagates after reporting generated tags and cleaning temporary state", () => {
  let reportPath
  let output = ""
  const failure = new Error("fake spawn failure")
  assert.throws(() => publishChangesets({
    changesetBin: "fake",
    write: line => { output += line },
    runner(_executable, _args, options) {
      reportPath = options.env.CHANGESETS_OUTPUT
      writeFileSync(reportPath, JSON.stringify(tag("@sensegrep/mcp")))
      return { error: failure, status: null }
    },
  }), error => error === failure)
  assert.equal(output, "New tag: @sensegrep/mcp@1.20.0\n")
  assert.equal(existsSync(path.dirname(reportPath)), false)
})

test("a thrown runner still cleans temporary state", () => {
  let reportPath
  assert.throws(() => publishChangesets({
    changesetBin: "fake",
    runner(_executable, _args, options) { reportPath = options.env.CHANGESETS_OUTPUT; throw new Error("fake failure") },
  }), /fake failure/)
  assert.equal(existsSync(path.dirname(reportPath)), false)
})

test("a signalled child without an exit status remains a failure", () => {
  assert.equal(publishChangesets({ changesetBin: "fake", runner: () => ({ status: null, signal: "SIGTERM" }) }), 1)
})
