import { AbsoluteFill, Series } from "remotion"
import { getTranscript, getTranscriptStep } from "./transcript"
import { IntroScene } from "./scenes/IntroScene"
import { SolutionScene } from "./scenes/SolutionScene"
import { FeaturesScene } from "./scenes/FeaturesScene"
import { OutroScene } from "./scenes/OutroScene"

type VideoVariant = "short" | "full"

type DemoVideoProps = {
  variant?: VideoVariant
}

type SequenceConfig = {
  kind: "intro" | "base" | "filtered" | "tree" | "outro"
  duration: number
}

const sequenceByVariant: Record<VideoVariant, SequenceConfig[]> = {
  short: [
    { kind: "intro", duration: 36 },
    { kind: "base", duration: 90 },
    { kind: "filtered", duration: 93 },
    { kind: "tree", duration: 60 },
    { kind: "outro", duration: 21 },
  ],
  full: [
    { kind: "intro", duration: 90 },
    { kind: "base", duration: 180 },
    { kind: "filtered", duration: 180 },
    { kind: "tree", duration: 210 },
    { kind: "outro", duration: 90 },
  ],
}

export const DemoVideo = ({ variant = "short" }: DemoVideoProps) => {
  const transcript = getTranscript()
  const sequences = sequenceByVariant[variant]

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0f" }}>
      <Series>
        {sequences.map((sequence, index) => {
          if (sequence.kind === "intro") {
            return (
              <Series.Sequence key={index} durationInFrames={sequence.duration}>
                <IntroScene
                  headline={
                    variant === "full"
                      ? "Find the right function in minutes, not file-hunting hours."
                      : "Find the right function by intent, not keywords."
                  }
                  subline={
                    variant === "full"
                      ? "Open-source semantic + structural code search for real codebases."
                      : "Open-source semantic + structural search for real codebases."
                  }
                />
              </Series.Sequence>
            )
          }

          if (sequence.kind === "base") {
            return (
              <Series.Sequence key={index} durationInFrames={sequence.duration}>
                <SolutionScene
                  title={variant === "full" ? "1) Search by meaning" : "Step 1: Semantic search finds intent-level matches"}
                  step={getTranscriptStep("semantic-base")}
                  accentColor="#818cf8"
                  terminalTitle={variant === "full" ? "sensegrep semantic search" : "sensegrep semantic search (Gemini)"}
                />
              </Series.Sequence>
            )
          }

          if (sequence.kind === "filtered") {
            return (
              <Series.Sequence key={index} durationInFrames={sequence.duration}>
                <SolutionScene
                  title={variant === "full" ? "2) Add structural filters to reduce noise" : "Step 2: Structural filters keep high-signal targets"}
                  step={getTranscriptStep("semantic-filtered")}
                  accentColor="#22c55e"
                  terminalTitle={
                    variant === "full"
                      ? "sensegrep semantic + structural filters"
                      : "sensegrep with structural filters (--type, --exported, --async)"
                  }
                  badgeTone="filtered"
                />
              </Series.Sequence>
            )
          }

          if (sequence.kind === "tree") {
            return (
              <Series.Sequence key={index} durationInFrames={sequence.duration}>
                <FeaturesScene
                  beforeStep={getTranscriptStep("tree-before")}
                  afterStep={getTranscriptStep("tree-after")}
                  variant={variant}
                />
              </Series.Sequence>
            )
          }

          return (
            <Series.Sequence key={index} durationInFrames={sequence.duration}>
              <OutroScene
                repo={transcript.repo}
                provider={transcript.provider}
                variant={variant}
                benchmark={transcript.benchmark}
              />
            </Series.Sequence>
          )
        })}
      </Series>
    </AbsoluteFill>
  )
}
