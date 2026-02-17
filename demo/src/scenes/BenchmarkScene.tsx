import React from "react"
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"
import type { VideoTranscript } from "../types"

type BenchmarkSceneProps = {
  benchmark: VideoTranscript["benchmark"]
}

function formatTokensCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return String(Math.round(value))
}

function formatPrecision(value: number) {
  return `${(value * 100).toFixed(0)}%`
}

type ModeRowProps = {
  label: string
  precision: number
  avgCalls: number
  avgTokens: number
  tone: "sensegrep" | "hybrid" | "grep"
}

const toneByMode: Record<ModeRowProps["tone"], { border: string; bg: string; text: string }> = {
  sensegrep: { border: "#22c55e66", bg: "#22c55e22", text: "#86efac" },
  hybrid: { border: "#818cf866", bg: "#818cf822", text: "#c4b5fd" },
  grep: { border: "#f59e0b66", bg: "#f59e0b22", text: "#fcd34d" },
}

const ModeRow: React.FC<ModeRowProps> = ({ label, precision, avgCalls, avgTokens, tone }) => {
  const colors = toneByMode[tone]
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 16,
        alignItems: "center",
        padding: "10px 14px",
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ color: colors.text, fontWeight: 800, fontSize: 19 }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 17 }}>precision {formatPrecision(precision)}</div>
      <div style={{ color: "#cbd5e1", fontWeight: 700, fontSize: 17 }}>{avgCalls.toFixed(2)} calls</div>
      <div style={{ color: "#cbd5e1", fontWeight: 700, fontSize: 17 }}>{formatTokensCompact(avgTokens)} tokens</div>
    </div>
  )
}

export const BenchmarkScene: React.FC<BenchmarkSceneProps> = ({ benchmark }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = spring({ frame, fps, config: { damping: 18 } })

  if (!benchmark) {
    return <AbsoluteFill style={{ backgroundColor: "#0a0a0f" }} />
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #151527 0%, #0a0a0f 70%)",
        padding: "34px 80px",
        opacity,
      }}
    >
      <div
        style={{
          width: "88%",
          borderRadius: 18,
          border: "1px solid #33415566",
          background: "#0f172a88",
          boxShadow: "0 0 40px #33415533",
          padding: "20px 26px",
        }}
      >
        <div style={{ textAlign: "center", color: "#e2e8f0", fontSize: 33, fontWeight: 800, fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
          {benchmark.name} benchmark
        </div>
        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 20, fontWeight: 600, marginTop: 6, fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
          repo {benchmark.repo} · {benchmark.runs} runs ({benchmark.tasks} tasks x {benchmark.modes} modes)
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <ModeRow
            label="sensegrep"
            precision={benchmark.sensegrep.precision}
            avgCalls={benchmark.sensegrep.avgCalls}
            avgTokens={benchmark.sensegrep.avgTokens}
            tone="sensegrep"
          />
          {benchmark.hybrid ? (
            <ModeRow
              label="hybrid"
              precision={benchmark.hybrid.precision}
              avgCalls={benchmark.hybrid.avgCalls}
              avgTokens={benchmark.hybrid.avgTokens}
              tone="hybrid"
            />
          ) : null}
          {benchmark.grep ? (
            <ModeRow
              label="grep"
              precision={benchmark.grep.precision}
              avgCalls={benchmark.grep.avgCalls}
              avgTokens={benchmark.grep.avgTokens}
              tone="grep"
            />
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  )
}
