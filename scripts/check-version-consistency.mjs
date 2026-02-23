#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readJson(relPath) {
  const abs = path.join(root, relPath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function fail(message) {
  console.error(`version-check: ${message}`);
  process.exitCode = 1;
}

const corePkgPath = "packages/core/package.json";
const cliPkgPath = "packages/cli/package.json";
const mcpPkgPath = "packages/mcp/package.json";
const serverMetaPath = "server.json";
const mcpRuntimePath = "packages/mcp/src/server.ts";

const corePkg = readJson(corePkgPath);
const cliPkg = readJson(cliPkgPath);
const mcpPkg = readJson(mcpPkgPath);
const serverMeta = readJson(serverMetaPath);
const mcpRuntime = fs.readFileSync(path.join(root, mcpRuntimePath), "utf8");

const expectedVersion = mcpPkg.version;

if (corePkg.version !== expectedVersion) {
  fail(`${corePkgPath} version (${corePkg.version}) != expected (${expectedVersion})`);
}

if (cliPkg.version !== expectedVersion) {
  fail(`${cliPkgPath} version (${cliPkg.version}) != expected (${expectedVersion})`);
}

const expectedCoreRange = `^${expectedVersion}`;
if (cliPkg.dependencies?.["@sensegrep/core"] !== expectedCoreRange) {
  fail(`${cliPkgPath} dependency @sensegrep/core (${cliPkg.dependencies?.["@sensegrep/core"]}) != ${expectedCoreRange}`);
}

if (mcpPkg.dependencies?.["@sensegrep/core"] !== expectedCoreRange) {
  fail(`${mcpPkgPath} dependency @sensegrep/core (${mcpPkg.dependencies?.["@sensegrep/core"]}) != ${expectedCoreRange}`);
}

if (serverMeta.version !== expectedVersion) {
  fail(`${serverMetaPath} version (${serverMeta.version}) != expected (${expectedVersion})`);
}

const mcpPackageEntry = Array.isArray(serverMeta.packages)
  ? serverMeta.packages.find((pkg) => pkg.identifier === "@sensegrep/mcp")
  : null;

if (!mcpPackageEntry) {
  fail(`${serverMetaPath} is missing packages entry for @sensegrep/mcp`);
} else if (mcpPackageEntry.version !== expectedVersion) {
  fail(`${serverMetaPath} packages[@sensegrep/mcp].version (${mcpPackageEntry.version}) != expected (${expectedVersion})`);
}

const runtimeVersionMatch = mcpRuntime.match(/version:\s*"([^"]+)"/);
if (!runtimeVersionMatch) {
  fail(`${mcpRuntimePath} runtime version field not found`);
} else if (runtimeVersionMatch[1] !== expectedVersion) {
  fail(`${mcpRuntimePath} runtime version (${runtimeVersionMatch[1]}) != expected (${expectedVersion})`);
}

if (process.exitCode === 1) {
  process.exit(1);
}

console.log(`version-check: OK (version ${expectedVersion})`);
