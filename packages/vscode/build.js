const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const watch = process.argv.includes("--watch")

if (!watch) {
  fs.rmSync(path.join(__dirname, "dist"), { recursive: true, force: true })
}

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
    console.error("[sensegrep] core dist not found at", coreDist)
    console.error("[sensegrep] build core first (npm run build from repo root)")
    process.exit(1)
  }

  const indexJs = path.join(coreDist, "index.js")
  if (!fs.existsSync(indexJs)) {
    console.error("[sensegrep] core dist is incomplete (missing index.js)")
    process.exit(1)
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(coreDist, dest, { recursive: true })
  if (fs.existsSync(corePackage)) {
    const pkg = JSON.parse(fs.readFileSync(corePackage, "utf8"))
    fs.writeFileSync(
      destPackage,
      JSON.stringify(
        {
          type: pkg.type ?? "module",
          bundledCoreVersion: pkg.version,
          name: pkg.name,
        },
        null,
        2,
      ),
    )
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
  const queue = initialDeps.map((name) => ({ name, from: rootNodeModules, optional: false }))

  const readPkg = (pkgPath) => {
    try {
      return JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    } catch {
      return null
    }
  }

  const resolvePackageDir = (dep, fromDir = rootNodeModules) => {
    const parts = dep.split("/")
    const candidates = []
    let current = fromDir
    while (current && current.startsWith(rootNodeModules)) {
      candidates.push(path.join(current, ...parts))
      if (current === rootNodeModules) break
      current = path.dirname(path.dirname(current))
    }
    candidates.push(path.join(rootNodeModules, ...parts))
    return candidates.find((candidate) => fs.existsSync(path.join(candidate, "package.json"))) ?? null
  }

  while (queue.length > 0) {
    const item = queue.pop()
    if (!item || visited.has(item.name)) continue
    const depPath = resolvePackageDir(item.name, item.from)
    if (!depPath) {
      if (!item.optional) console.warn(`[sensegrep] dependency not found: ${item.name}`)
      continue
    }
    visited.add(item.name)

    const pkg = readPkg(path.join(depPath, "package.json"))
    if (!pkg) continue

    for (const name of Object.keys(pkg.dependencies || {})) {
      if (!visited.has(name)) queue.push({ name, from: path.join(depPath, "node_modules"), optional: false })
    }
    for (const name of Object.keys(pkg.optionalDependencies || {})) {
      if (!visited.has(name)) queue.push({ name, from: path.join(depPath, "node_modules"), optional: true })
    }
  }

  fs.mkdirSync(destNodeModules, { recursive: true })
  for (const dep of visited) {
    const src = resolvePackageDir(dep, rootNodeModules)
    if (!src) continue
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
