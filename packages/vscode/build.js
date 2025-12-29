const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const watch = process.argv.includes("--watch")

const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node18",
  format: "cjs",
  minify: !watch,
  sourcemap: true,
  external: [
    "vscode",
    "@sensegrep/core",
    // Native modules that can't be bundled
    "@lancedb/lancedb",
    "onnxruntime-node",
    "@xenova/transformers",
  ],
  loader: {
    ".ts": "ts",
  },
  logLevel: "info",
}

function copyBundledCore() {
  const coreDist = path.join(__dirname, "..", "core", "dist")
  const dest = path.join(__dirname, "dist", "core")
  const corePackage = path.join(__dirname, "..", "core", "package.json")
  const destPackage = path.join(dest, "package.json")

  if (!fs.existsSync(coreDist)) {
    console.warn("[sensegrep] core dist not found, skipping bundled core copy")
    return
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(coreDist, dest, { recursive: true })
  if (fs.existsSync(corePackage)) {
    const pkg = JSON.parse(fs.readFileSync(corePackage, "utf8"))
    fs.writeFileSync(destPackage, JSON.stringify({ type: pkg.type ?? "module" }, null, 2))
  } else {
    fs.writeFileSync(destPackage, JSON.stringify({ type: "module" }, null, 2))
  }
}

function copyCoreDependencies() {
  const corePackage = path.join(__dirname, "..", "core", "package.json")
  const rootNodeModules = path.join(__dirname, "..", "..", "node_modules")
  const destNodeModules = path.join(__dirname, "dist", "core", "node_modules")

  if (!fs.existsSync(corePackage)) {
    console.warn("[sensegrep] core package.json not found, skipping deps copy")
    return
  }

  const corePkg = JSON.parse(fs.readFileSync(corePackage, "utf8"))
  const initialDeps = Object.keys(corePkg.dependencies || {})
  if (initialDeps.length === 0) return

  const visited = new Set()
  const queue = [...initialDeps]

  const readPkg = (pkgPath) => {
    try {
      return JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    } catch {
      return null
    }
  }

  while (queue.length > 0) {
    const dep = queue.pop()
    if (!dep || visited.has(dep)) continue
    visited.add(dep)

    const depPath = path.join(rootNodeModules, ...dep.split("/"))
    const pkg = readPkg(path.join(depPath, "package.json"))
    if (!pkg) continue

    const next = {
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
      ...(pkg.peerDependencies || {}),
    }
    for (const name of Object.keys(next)) {
      if (!visited.has(name)) queue.push(name)
    }
  }

  fs.mkdirSync(destNodeModules, { recursive: true })
  for (const dep of visited) {
    const src = path.join(rootNodeModules, ...dep.split("/"))
    const dest = path.join(destNodeModules, ...dep.split("/"))
    if (!fs.existsSync(src)) {
      console.warn(`[sensegrep] dependency not found: ${dep}`)
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(src, dest, { recursive: true })
  }
}

if (watch) {
  esbuild.context(config).then((ctx) => {
    ctx.watch()
    copyBundledCore()
    copyCoreDependencies()
    console.log("Watching for changes...")
  })
} else {
  esbuild.build(config).then(() => {
    copyBundledCore()
    copyCoreDependencies()
    console.log("Build complete!")
  }).catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
