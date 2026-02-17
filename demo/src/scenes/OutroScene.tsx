import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

type OutroSceneProps = {
  repo: string
  provider: string
  variant: "short" | "full"
}

export const OutroScene: React.FC<OutroSceneProps> = ({ repo, provider, variant }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleScale = spring({ frame, fps, config: { damping: 12 } })
  const installOpacity = interpolate(frame, [fps * 0.35, fps * 0.9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #1a1a35 0%, #0a0a0f 72%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(129, 140, 248, 0.14) 0%, transparent 72%)",
          filter: "blur(46px)",
        }}
      />

      <div style={{ textAlign: "center", transform: `scale(${titleScale})` }}>
        <div
          style={{
            fontSize: variant === "full" ? 64 : 68,
            fontWeight: 800,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            background: "linear-gradient(135deg, #e2e8f0, #a5b4fc)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            letterSpacing: -2,
          }}
        >
          {variant === "full" ? "Start in under 2 minutes" : "Search by meaning, then filter with structure"}
        </div>
        {variant === "full" ? (
          <div
            style={{
              marginTop: 14,
              fontSize: 29,
              color: "#cbd5e1",
              fontWeight: 700,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
            }}
          >
            github.com/Stahldavid/sensegrep
          </div>
        ) : null}
      </div>

      {variant === "full" ? (
        <div
          style={{
            marginTop: 18,
            padding: "10px 24px",
            borderRadius: 12,
            background: "#1e1e35",
            border: "1px solid #818cf844",
            color: "#86efac",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
          }}
        >
          npm i -g @sensegrep/cli && sensegrep index --root .
        </div>
      ) : null}

      <div style={{ textAlign: "center", marginTop: variant === "full" ? 20 : 28, opacity: variant === "full" ? 1 : installOpacity }}>
        <div
          style={{
            display: "inline-block",
            padding: "12px 30px",
            borderRadius: 12,
            backgroundColor: "#1e1e35",
            border: "1px solid #818cf844",
          }}
        >
          <span style={{ fontSize: 24, fontFamily: "'Cascadia Code', 'Fira Code', monospace", color: "#4ade80" }}>
            {variant === "full" ? "Apache-2.0 · CLI · MCP · VS Code" : "npm i -g @sensegrep/cli"}
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 18,
          color: "#94a3b8",
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        }}
      >
        {repo.replace("https://github.com/", "")}{" "}· {provider} embeddings · {variant === "short" ? "10s hero" : "25s full"}
      </div>
    </AbsoluteFill>
  )
}
