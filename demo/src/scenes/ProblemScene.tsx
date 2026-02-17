import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { Terminal, type TerminalLine } from "../components/Terminal"
import type { TranscriptStep } from "../types"

type ProblemSceneProps = {
  step: TranscriptStep
}

export const ProblemScene: React.FC<ProblemSceneProps> = ({ step }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = spring({ frame, fps, config: { damping: 20 } })
  const badgeOpacity = interpolate(frame, [fps * 1.8, fps * 2.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const lines: TerminalLine[] = [
    { text: `$ ${step.command}`, color: "#4ade80", delay: 0.2 },
    ...step.stdoutLines.map((text, index) => ({
      text,
      color: step.highlights.includes(index) ? "#fca5a5" : "#cbd5e1",
      delay: 0.5 + index * 0.18,
    })),
  ]

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "#0a0a0f",
        padding: "40px 80px",
      }}
    >
      <div style={{ position: "absolute", top: 46, textAlign: "center", opacity: titleOpacity }}>
        <span
          style={{
            fontSize: 38,
            fontWeight: 700,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: "#e2e8f0",
          }}
        >
          Keyword search returns noise
        </span>
      </div>

      <div style={{ width: "90%", marginTop: 40 }}>
        <Terminal
          title="Problem: keyword matching"
          lines={lines}
          accentColor="#ef4444"
          highlightRows={step.highlights.map((x) => x + 1)}
          lineBadges={Object.fromEntries(step.highlights.map((row) => [row + 1, { label: "noise", tone: "note" as const }]))}
        />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 58,
          opacity: badgeOpacity,
          padding: "10px 24px",
          borderRadius: 999,
          background: "#ef444422",
          border: "1px solid #ef444466",
          color: "#fca5a5",
          fontSize: 21,
          fontWeight: 700,
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        }}
      >
        {step.note}
      </div>
    </AbsoluteFill>
  )
}
