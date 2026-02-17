import React from "react"
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { Terminal } from "../components/Terminal"
import type { TranscriptStep } from "../types"

type FeaturesSceneProps = {
  beforeStep: TranscriptStep
  afterStep: TranscriptStep
}

export const FeaturesScene: React.FC<FeaturesSceneProps> = ({ beforeStep, afterStep }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const titleOpacity = spring({ frame, fps, config: { damping: 20 } })
  const removedLines = Math.max(0, beforeStep.stdoutLines.length - afterStep.stdoutLines.length)

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #141428 0%, #0a0a0f 72%)",
        padding: "40px 80px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 46,
          opacity: titleOpacity,
          fontSize: 38,
          fontWeight: 700,
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          color: "#e2e8f0",
          textAlign: "center",
        }}
      >
        3) Tree-shake context to what matters
      </div>

      <div style={{ width: "92%", marginTop: 36 }}>
        <Terminal
          mode="diff"
          title="Tree-shaking output"
          accentColor="#22c55e"
          beforeLines={beforeStep.stdoutLines.map((text, index) => ({ text, delay: 0.2 + index * 0.08, color: "#fca5a5" }))}
          afterLines={afterStep.stdoutLines.map((text, index) => ({ text, delay: 0.2 + index * 0.08, color: "#86efac" }))}
          diffSwitchAt={1.8}
          leftTitle="Before: raw symbol context"
          rightTitle="After: relevant logic only"
        />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 52,
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
        Read less, act faster. (-{removedLines} lines)
      </div>
    </AbsoluteFill>
  )
}
