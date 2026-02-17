import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import type { VideoTranscript } from "../types"

type OutroSceneProps = {
  repo: string
  provider: string
  variant: "short" | "full"
  benchmark?: VideoTranscript["benchmark"]
}

function formatTokensCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return String(Math.round(value))
}

export const OutroScene: React.FC<OutroSceneProps> = ({ repo, provider, variant, benchmark }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const isShort = variant === "short"

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
          {variant === "full" ? "Start in under 2 minutes" : "Open-source code search in 2 commands"}
        </div>
        <div
          style={{
            marginTop: isShort ? 14 : 10,
            fontSize: isShort ? 26 : 29,
            color: "#cbd5e1",
            fontWeight: 700,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
          }}
        >
          github.com/Stahldavid/sensegrep
        </div>
      </div>

      {variant === "full" && benchmark ? (
        <div
          style={{
            marginTop: 14,
            padding: "10px 18px",
            borderRadius: 14,
            border: "1px solid #818cf844",
            background: "#0f102088",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 15,
              color: "#a5b4fc",
              fontWeight: 700,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
            }}
          >
            AI SDK benchmark · {benchmark.runs} runs ({benchmark.tasks} tasks x {benchmark.modes} modes)
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 16,
              color: "#86efac",
              fontWeight: 700,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
            }}
          >
            sensegrep: {benchmark.sensegrep.avgCalls.toFixed(1)} calls · {formatTokensCompact(benchmark.sensegrep.avgTokens)} tokens
          </div>
          {benchmark.hybrid && benchmark.grep ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 14,
                color: "#cbd5e1",
                fontFamily: "'Inter', 'Segoe UI', sans-serif",
              }}
            >
              hybrid: {benchmark.hybrid.avgCalls.toFixed(2)} calls · {formatTokensCompact(benchmark.hybrid.avgTokens)} tokens | grep:{" "}
              {benchmark.grep.avgCalls.toFixed(2)} calls · {formatTokensCompact(benchmark.grep.avgTokens)} tokens
            </div>
          ) : null}
        </div>
      ) : null}

      {variant === "full" ? (
        <div
          style={{
            marginTop: 14,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-block",
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
          <div
            style={{
              marginTop: 10,
              color: "#94a3b8",
              fontSize: 18,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              fontWeight: 600,
            }}
          >
            or use MCP instantly: npx -y @sensegrep/mcp
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            opacity: installOpacity,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 12,
              backgroundColor: "#1e1e35",
              border: "1px solid #818cf844",
            }}
          >
            <span style={{ fontSize: 21, fontFamily: "'Cascadia Code', 'Fira Code', monospace", color: "#4ade80" }}>
              npm i -g @sensegrep/cli
            </span>
          </div>
          <div
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 12,
              backgroundColor: "#1e1e35",
              border: "1px solid #818cf844",
            }}
          >
            <span style={{ fontSize: 21, fontFamily: "'Cascadia Code', 'Fira Code', monospace", color: "#4ade80" }}>
              npx -y @sensegrep/mcp
            </span>
          </div>
        </div>
      )}

      {variant === "short" ? (
        <div style={{ textAlign: "center", marginTop: 16, opacity: installOpacity }}>
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
              CLI · MCP · VS Code
            </span>
          </div>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 14,
          fontSize: 18,
          color: "#94a3b8",
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        }}
      >
        {variant === "short"
          ? `${repo.replace("https://github.com/", "")} · ${provider} embeddings`
          : "Apache-2.0 · CLI · MCP · VS Code"}
      </div>
    </AbsoluteFill>
  )
}
