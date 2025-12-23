/**
 * Embeddings module - re-exports from the new @huggingface/transformers v3 implementation
 *
 * This module now uses @huggingface/transformers v3 instead of @xenova/transformers v2.
 * Benefits:
 * - WebGPU support for GPU acceleration (10-20x faster)
 * - Latest model support (ModernBERT, Qwen3, etc.)
 * - Active maintenance and bug fixes
 *
 * To use GPU acceleration, set environment variable:
 *   OPENCODE_EMBEDDINGS_DEVICE=cuda  (for NVIDIA GPU)
 *   OPENCODE_EMBEDDINGS_DEVICE=cpu   (default, for CPU)
 */

import { EmbeddingsHF } from "./embeddings-hf.js"

// Re-export the new implementation with the original namespace name for backward compatibility
export const Embeddings = EmbeddingsHF
