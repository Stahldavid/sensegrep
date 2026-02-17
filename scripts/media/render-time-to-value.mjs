#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { execFileSync, execSync } from "node:child_process"

const rootDir = process.cwd()
const demoPackage = path.join(rootDir, "demo", "package.json")
const assetsDir = path.join(rootDir, "assets")
const npmCommand = process.platform === "win32" ? "npm" : "npm"

const argVariant = process.argv[2]
const envVariant = process.env.SENSEGREP_VIDEO_VARIANT
const variant = argVariant === "full" || envVariant === "full" ? "full" : "short"

const compositionId = variant === "full" ? "DemoVideoFull" : "DemoVideoShort"
const demoFileName = variant === "full" ? "sensegrep-demo-full.mp4" : "sensegrep-demo-short.mp4"
const demoOutput = path.join(rootDir, "demo", "out", demoFileName)
const demoOutputRelative = path.join("out", demoFileName).replaceAll("\\", "/")
const finalOutput =
  variant === "full"
    ? path.join(assetsDir, "time-to-value-full.mp4")
    : path.join(assetsDir, "time-to-value.mp4")

const outputWidth = variant === "full" ? 1920 : 1600
const outputDuration = variant === "full" ? 25 : 10

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

fs.mkdirSync(assetsDir, { recursive: true })

if (fs.existsSync(demoPackage)) {
  console.log(`Rendering ${compositionId} with Remotion...`)
  execSync(`${npmCommand} --prefix demo run render -- ${compositionId} ${demoOutputRelative}`, {
    stdio: "inherit",
    shell: true,
  })
}

if (!fs.existsSync(demoOutput)) {
  console.error(`No source video found at ${path.relative(rootDir, demoOutput)}.`)
  process.exit(1)
}

if (hasFfmpeg()) {
  console.log(`Encoding ${variant} MP4 for assets...`)
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      demoOutput,
      "-t",
      String(outputDuration),
      "-an",
      "-vf",
      `scale=${outputWidth}:-2:flags=lanczos`,
      "-c:v",
      "libx264",
      "-preset",
      "faster",
      "-crf",
      variant === "full" ? "21" : "20",
      finalOutput,
    ],
    { stdio: "inherit" }
  )
} else {
  console.log("ffmpeg not found; copying source MP4 without transcoding.")
  fs.copyFileSync(demoOutput, finalOutput)
}

const stats = fs.statSync(finalOutput)
console.log(`Saved ${path.relative(rootDir, finalOutput)} (${Math.round(stats.size / 1024)} KB).`)
