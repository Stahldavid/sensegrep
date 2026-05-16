/**
 * Embeddings module.
 *
 * The runtime is remote-only and supports Gemini, OpenAI-compatible, and Amazon Bedrock embedding APIs.
 */

import { EmbeddingsRemote } from "./embeddings-remote.js"

// Re-export the new implementation with the original namespace name for backward compatibility
export const Embeddings = EmbeddingsRemote
