export type TranscriptStep = {
  id: string
  command: string
  stdoutLines: string[]
  highlights: number[]
  note: string
}

export type VideoTranscript = {
  repo: string
  commit: string
  capturedAt: string
  provider: "gemini"
  embedModel?: string
  rootPlaceholder: string
  benchmark?: {
    runs: number
    tasks: number
    modes: number
    avgCalls: number
  }
  steps: TranscriptStep[]
}
