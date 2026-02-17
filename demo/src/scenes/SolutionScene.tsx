import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { Terminal, type TerminalLine } from "../components/Terminal"
import type { TranscriptStep } from "../types"

type SolutionSceneProps = {
  title: string
  step: TranscriptStep
  accentColor: string
  terminalTitle?: string
  badgeTone?: "score" | "filtered"
}

export const SolutionScene: React.FC<SolutionSceneProps> = ({
  title,
  step,
  accentColor,
  terminalTitle = "sensegrep semantic search (Gemini embeddings)",
  badgeTone = "score",
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = spring({ frame, fps, config: { damping: 20 } })
  const badgeOpacity = interpolate(frame, [fps * 1.8, fps * 2.3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const lines: TerminalLine[] = [
    { text: `$ ${step.command}`, color: "#a5b4fc", delay: 0.2 },
    ...step.stdoutLines.map((text, index) => ({
      text,
      color: step.highlights.includes(index) ? "#86efac" : "#cbd5e1",
      delay: 0.5 + index * 0.18,
    })),
  ]

  const badges = Object.fromEntries(
    step.highlights.map((row) => [
      row + 1,
      {
        label: row === step.highlights[0] ? (badgeTone === "filtered" ? "filtered" : "top hit") : "score",
        tone: badgeTone,
      },
    ])
  )

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
            fontSize: 37,
            fontWeight: 700,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: "#e2e8f0",
          }}
        >
          {title}
        </span>
      </div>

      <div style={{ width: "90%", marginTop: 40 }}>
        <Terminal
          title={terminalTitle}
          lines={lines}
          accentColor={accentColor}
          highlightRows={step.highlights.map((x) => x + 1)}
          lineBadges={badges}
        />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 58,
          opacity: badgeOpacity,
          padding: "10px 24px",
          borderRadius: 999,
          background: "#22c55e22",
          border: "1px solid #22c55e66",
          color: "#86efac",
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
