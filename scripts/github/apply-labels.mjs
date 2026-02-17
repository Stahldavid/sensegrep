#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const rootDir = process.cwd()
const labelsPath = path.join(rootDir, "scripts", "github", "labels.json")

function runGh(args, options = {}) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  })
  return typeof output === "string" ? output.trim() : ""
}

function ensureGhAvailable() {
  try {
    runGh(["--version"])
  } catch {
    throw new Error("GitHub CLI (gh) is required. Install gh and run `gh auth login` first.")
  }
}

function ensureAuthenticated() {
  try {
    runGh(["auth", "status"])
  } catch {
    throw new Error("GitHub CLI is not authenticated. Run `gh auth login` first.")
  }
}

function resolveRepo() {
  const argRepo = process.argv.find((arg) => arg.startsWith("--repo="))
  if (argRepo) {
    return argRepo.slice("--repo=".length)
  }

  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY
  }

  return runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
}

function main() {
  ensureGhAvailable()
  ensureAuthenticated()

  if (!fs.existsSync(labelsPath)) {
    throw new Error(`Labels file not found: ${labelsPath}`)
  }

  const repo = resolveRepo()
  const labels = JSON.parse(fs.readFileSync(labelsPath, "utf8"))
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new Error("labels.json must contain a non-empty array")
  }

  console.log(`Applying ${labels.length} labels to ${repo}...`)
  for (const label of labels) {
    if (!label?.name || !label?.color || !label?.description) {
      throw new Error(`Invalid label entry: ${JSON.stringify(label)}`)
    }

    runGh(
      [
        "label",
        "create",
        label.name,
        "--repo",
        repo,
        "--color",
        label.color,
        "--description",
        label.description,
        "--force",
      ],
      { stdio: "inherit" }
    )
  }

  console.log("Label sync complete.")
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to apply labels: ${message}`)
  process.exit(1)
}
