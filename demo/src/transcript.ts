import transcriptRaw from "../data/video-transcript.json"
import type { TranscriptStep, VideoTranscript } from "./types"

const transcript = transcriptRaw as VideoTranscript

const stepMap = new Map<string, TranscriptStep>(
  transcript.steps.map((step) => [step.id, step])
)

export function getTranscript(): VideoTranscript {
  return transcript
}

export function getTranscriptStep(stepId: string): TranscriptStep {
  return (
    stepMap.get(stepId) ?? {
      id: stepId,
      command: "",
      stdoutLines: ["No transcript data available."],
      highlights: [],
      note: "Missing transcript step",
    }
  )
}
