import React from "react"
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

export type TerminalLine = {
  text: string
  color?: string
  delay: number
}

type LineBadge = {
  label: string
  tone?: "score" | "filtered" | "note"
}

type TerminalProps = {
  title: string
  lines?: TerminalLine[]
  accentColor?: string
  highlightRows?: number[]
  lineBadges?: Record<number, LineBadge>
  mode?: "default" | "diff"
  beforeLines?: TerminalLine[]
  afterLines?: TerminalLine[]
  diffSwitchAt?: number
  leftTitle?: string
  rightTitle?: string
}

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace"

function badgeStyle(tone: LineBadge["tone"]) {
  if (tone === "filtered") {
    return { bg: "#22c55e22", color: "#4ade80", border: "#4ade8044" }
  }
  if (tone === "note") {
    return { bg: "#f59e0b22", color: "#fbbf24", border: "#fbbf2444" }
  }
  return { bg: "#818cf822", color: "#a5b4fc", border: "#a5b4fc44" }
}

function renderTypedLine(
  line: TerminalLine,
  index: number,
  frame: number,
  fps: number,
  accentColor: string,
  highlightRows: number[],
  lineBadges: Record<number, LineBadge> | undefined
) {
  const lineFrame = line.delay * fps
  const opacity = interpolate(frame, [lineFrame, lineFrame + 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const charsToShow = Math.floor(
    interpolate(frame, [lineFrame, lineFrame + Math.max(line.text.length * 0.45, 8)], [0, line.text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  )

  const showCursor = charsToShow < line.text.length && frame >= lineFrame
  const badge = lineBadges?.[index]
  const badgeColors = badge ? badgeStyle(badge.tone) : null

  return (
    <div
      key={`line-${index}`}
      style={{
        opacity,
        whiteSpace: "pre",
        display: "flex",
        alignItems: "center",
        gap: 10,
        backgroundColor: highlightRows.includes(index) ? "#1f293733" : "transparent",
        borderLeft: highlightRows.includes(index) ? `2px solid ${accentColor}` : "2px solid transparent",
        padding: "2px 8px",
      }}
    >
      <span style={{ color: line.color ?? "#e2e8f0", flex: 1 }}>{line.text.slice(0, charsToShow)}</span>
      {badge && badgeColors ? (
        <span
          style={{
            border: `1px solid ${badgeColors.border}`,
            borderRadius: 999,
            padding: "1px 8px",
            background: badgeColors.bg,
            color: badgeColors.color,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {badge.label}
        </span>
      ) : null}
      {showCursor ? (
        <span
          style={{
            backgroundColor: accentColor,
            color: "#0a0a0f",
            padding: "0 2px",
          }}
        >
          {" "}
        </span>
      ) : null}
    </div>
  )
}

export const Terminal: React.FC<TerminalProps> = ({
  title,
  lines = [],
  accentColor = "#4ade80",
  highlightRows = [],
  lineBadges,
  mode = "default",
  beforeLines = [],
  afterLines = [],
  diffSwitchAt = 2,
  leftTitle = "Before",
  rightTitle = "After",
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const diffFrame = Math.max(0, frame - diffSwitchAt * fps)
  const beforeOpacity = mode === "diff" ? interpolate(diffFrame, [0, 12], [1, 0.35], { extrapolateRight: "clamp" }) : 1
  const afterOpacity = mode === "diff" ? spring({ frame: diffFrame, fps, config: { damping: 16 } }) : 1

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${accentColor}33`,
        boxShadow: `0 0 35px ${accentColor}1a`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          backgroundColor: "#1a1a2e",
          borderBottom: "1px solid #2a2a3e",
        }}
      >
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ff5f57" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#febc2e" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#28c840" }} />
        <span
          style={{
            marginLeft: 8,
            color: "#94a3b8",
            fontSize: 14,
            fontFamily: MONO_FONT,
            fontWeight: 600,
          }}
        >
          {title}
        </span>
      </div>

      <div
        style={{
          padding: "16px 20px",
          backgroundColor: "#12121e",
          minHeight: 220,
          fontFamily: MONO_FONT,
          fontSize: 15,
          lineHeight: 1.55,
        }}
      >
        {mode === "default" ? (
          <div>
            {lines.map((line, index) => renderTypedLine(line, index, frame, fps, accentColor, highlightRows, lineBadges))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ opacity: beforeOpacity }}>
              <div style={{ color: "#fca5a5", marginBottom: 8, fontSize: 13 }}>{leftTitle}</div>
              {beforeLines.map((line, index) => (
                <div key={`before-${index}`} style={{ color: line.color ?? "#f1f5f9", whiteSpace: "pre", padding: "1px 6px" }}>
                  {line.text}
                </div>
              ))}
            </div>
            <div style={{ opacity: afterOpacity }}>
              <div style={{ color: "#86efac", marginBottom: 8, fontSize: 13 }}>{rightTitle}</div>
              {afterLines.map((line, index) => (
                <div
                  key={`after-${index}`}
                  style={{
                    color: line.color ?? "#f1f5f9",
                    whiteSpace: "pre",
                    padding: "1px 6px",
                    backgroundColor: "#14532d22",
                    borderLeft: "2px solid #22c55e66",
                  }}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
