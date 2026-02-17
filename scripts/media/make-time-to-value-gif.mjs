#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const rootDir = process.cwd()
const assetsDir = path.join(rootDir, "assets")
const inputVideo = path.join(assetsDir, "time-to-value.mp4")
const outputGif = path.join(assetsDir, "time-to-value.gif")

function runFfmpeg(args) {
  execFileSync("ffmpeg", args, { stdio: "inherit" })
}

function ensureFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
  } catch {
    console.error("ffmpeg is required to generate GIF assets.")
    process.exit(1)
  }
}

function generateGif(scaleWidth, fps) {
  const palette = path.join(os.tmpdir(), `sensegrep-palette-${Date.now()}.png`)
  try {
    runFfmpeg([
      "-y",
      "-t",
      "10",
      "-i",
      inputVideo,
      "-vf",
      `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos,palettegen=max_colors=128`,
      "-frames:v",
      "1",
      "-update",
      "1",
      palette,
    ])

    runFfmpeg([
      "-y",
      "-t",
      "10",
      "-i",
      inputVideo,
      "-i",
      palette,
      "-lavfi",
      `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
      outputGif,
    ])
  } finally {
    if (fs.existsSync(palette)) {
      fs.unlinkSync(palette)
    }
  }
}

if (!fs.existsSync(inputVideo)) {
  console.error("Input video not found. Run `npm run demo:render:short` first.")
  process.exit(1)
}

ensureFfmpeg()
fs.mkdirSync(assetsDir, { recursive: true })

console.log("Generating GIF (pass 1)...")
generateGif(960, 10)

let size = fs.statSync(outputGif).size
const maxSize = 2.5 * 1024 * 1024

if (size > maxSize) {
  console.log("GIF is above 2.5MB; regenerating with lower settings...")
  generateGif(820, 8)
  size = fs.statSync(outputGif).size
}

console.log(`Saved ${path.relative(rootDir, outputGif)} (${(size / 1024 / 1024).toFixed(2)} MB).`)
