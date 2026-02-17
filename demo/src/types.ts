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
    name: string
    repo: string
    runs: number
    tasks: number
    modes: number
    sensegrep: {
      precision: number
      avgCalls: number
      avgTokens: number
    }
    hybrid?: {
      precision: number
      avgCalls: number
      avgTokens: number
    }
    grep?: {
      precision: number
      avgCalls: number
      avgTokens: number
    }
  }
  steps: TranscriptStep[]
}
