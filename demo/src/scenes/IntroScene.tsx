import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

type IntroSceneProps = {
  headline: string
  subline: string
}

export const IntroScene: React.FC<IntroSceneProps> = ({ headline, subline }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleScale = spring({ frame, fps, config: { damping: 14 } })
  const sublineOpacity = interpolate(frame, [fps * 0.35, fps * 0.9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #141428 0%, #0a0a0f 70%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(129, 140, 248, 0.18) 0%, transparent 72%)",
          filter: "blur(44px)",
        }}
      />

      <div style={{ textAlign: "center", transform: `scale(${titleScale})`, maxWidth: 1480 }}>
        <div
          style={{
            fontSize: 78,
            fontWeight: 800,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            lineHeight: 1.1,
            letterSpacing: -2,
            background: "linear-gradient(135deg, #e2e8f0, #a5b4fc)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          {headline}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 28,
            color: "#94a3b8",
            opacity: sublineOpacity,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            fontWeight: 500,
            letterSpacing: 0.3,
          }}
        >
          {subline}
        </div>
      </div>
    </AbsoluteFill>
  )
}
