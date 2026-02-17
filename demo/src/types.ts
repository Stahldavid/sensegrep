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
    sensegrep: {
      avgCalls: number
      avgTokens: number
    }
    hybrid?: {
      avgCalls: number
      avgTokens: number
    }
    grep?: {
      avgCalls: number
      avgTokens: number
    }
  }
  steps: TranscriptStep[]
}
