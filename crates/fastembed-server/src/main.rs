use std::{net::SocketAddr, sync::Arc};

use anyhow::{anyhow, bail, Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use tracing_subscriber::EnvFilter;

const JINA_CODE_MODEL: &str = "jinaai/jina-embeddings-v2-base-code";
const JINA_CODE_DIM: usize = 768;
const DEFAULT_BATCH_SIZE: usize = 8;
const DEFAULT_MAX_CHARS: usize = 32_768;
const DEFAULT_MAX_INPUTS: usize = 256;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    /// Bind host for the HTTP server.
    #[arg(long, env = "SENSEGREP_FASTEMBED_HOST", default_value = "127.0.0.1")]
    host: String,

    /// Bind port for the HTTP server.
    #[arg(long, env = "SENSEGREP_FASTEMBED_PORT", default_value_t = 11435)]
    port: u16,

    /// Embedding model. Initial Sensegrep support intentionally allows only jina-code.
    #[arg(long, env = "SENSEGREP_FASTEMBED_MODEL", default_value = JINA_CODE_MODEL)]
    model: String,

    /// Max inputs passed to fastembed-rs per internal embed call.
    /// Keep this low for CPU-only droplets; the Sensegrep indexer may send larger HTTP batches.
    #[arg(long, env = "SENSEGREP_FASTEMBED_BATCH_SIZE", default_value_t = DEFAULT_BATCH_SIZE)]
    batch_size: usize,

    /// Max UTF-8 characters per input before truncation. Jina code is ~8k tokens;
    /// char-based truncation keeps the sidecar robust without adding a tokenizer pass here.
    #[arg(long, env = "SENSEGREP_FASTEMBED_MAX_CHARS", default_value_t = DEFAULT_MAX_CHARS)]
    max_chars: usize,

    /// Max number of input strings accepted in a single HTTP request.
    #[arg(long, env = "SENSEGREP_FASTEMBED_MAX_INPUTS", default_value_t = DEFAULT_MAX_INPUTS)]
    max_inputs: usize,
}

#[derive(Clone)]
struct AppState {
    model_id: String,
    batch_size: usize,
    max_chars: usize,
    max_inputs: usize,
    embedder: Arc<Mutex<TextEmbedding>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Input {
    One(String),
    Many(Vec<String>),
}

impl Input {
    fn into_vec(self) -> Vec<String> {
        match self {
            Input::One(value) => vec![value],
            Input::Many(values) => values,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EmbeddingsRequest {
    model: Option<String>,
    input: Input,
}

#[derive(Debug, Serialize)]
struct EmbeddingDatum {
    object: &'static str,
    index: usize,
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize)]
struct EmbeddingsResponse {
    object: &'static str,
    model: String,
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Serialize)]
struct ModelInfo {
    id: &'static str,
    object: &'static str,
    dimensions: usize,
    provider: &'static str,
}

struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": {
                    "message": message,
                    "type": "invalid_request_error"
                }
            })),
        )
            .into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(error: E) -> Self {
        AppError(error.into())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    if args.model != JINA_CODE_MODEL {
        bail!(
            "initial fastembed-rs support only includes {JINA_CODE_MODEL}; received {}",
            args.model
        );
    }
    if args.batch_size == 0 {
        bail!("--batch-size must be greater than zero");
    }
    if args.max_chars == 0 {
        bail!("--max-chars must be greater than zero");
    }
    if args.max_inputs == 0 {
        bail!("--max-inputs must be greater than zero");
    }

    let embedder = TextEmbedding::try_new(
        TextInitOptions::new(EmbeddingModel::JinaEmbeddingsV2BaseCode)
            .with_show_download_progress(true),
    )
    .context("failed to initialize fastembed-rs jina-code model")?;

    let state = AppState {
        model_id: args.model,
        batch_size: args.batch_size,
        max_chars: args.max_chars,
        max_inputs: args.max_inputs,
        embedder: Arc::new(Mutex::new(embedder)),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/models", get(models))
        .route("/v1/embeddings", post(embeddings))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .context("invalid bind address")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        %addr,
        model = JINA_CODE_MODEL,
        batch_size = args.batch_size,
        max_chars = args.max_chars,
        max_inputs = args.max_inputs,
        "sensegrep fastembed-rs sidecar listening"
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "provider": "fastembed-rs",
        "model": state.model_id,
        "dimensions": JINA_CODE_DIM,
        "batchSize": state.batch_size,
        "maxChars": state.max_chars,
        "maxInputs": state.max_inputs
    }))
}

async fn models() -> Json<serde_json::Value> {
    Json(json!({
        "object": "list",
        "data": [ModelInfo {
            id: JINA_CODE_MODEL,
            object: "model",
            dimensions: JINA_CODE_DIM,
            provider: "fastembed-rs"
        }]
    }))
}

async fn embeddings(
    State(state): State<AppState>,
    Json(request): Json<EmbeddingsRequest>,
) -> Result<Json<EmbeddingsResponse>, AppError> {
    let requested_model = request.model.as_deref().unwrap_or(JINA_CODE_MODEL);
    if requested_model != JINA_CODE_MODEL {
        return Err(AppError(anyhow!(
            "unsupported model {requested_model}; initial support only includes {JINA_CODE_MODEL}"
        )));
    }

    let input = request.input.into_vec();
    if input.len() > state.max_inputs {
        return Err(AppError(anyhow!(
            "too many inputs: received {}, max {}",
            input.len(),
            state.max_inputs
        )));
    }
    if input.is_empty() {
        return Ok(Json(EmbeddingsResponse {
            object: "list",
            model: state.model_id,
            data: Vec::new(),
        }));
    }

    let input = truncate_inputs(input, state.max_chars);
    let embedder = Arc::clone(&state.embedder);
    let batch_size = state.batch_size;
    let embeddings =
        tokio::task::spawn_blocking(move || embed_in_batches(embedder, input, batch_size))
            .await
            .context("fastembed-rs worker task failed")??;

    let data = embeddings
        .into_iter()
        .enumerate()
        .map(|(index, embedding)| EmbeddingDatum {
            object: "embedding",
            index,
            embedding,
        })
        .collect();

    Ok(Json(EmbeddingsResponse {
        object: "list",
        model: state.model_id,
        data,
    }))
}

fn truncate_inputs(inputs: Vec<String>, max_chars: usize) -> Vec<String> {
    inputs
        .into_iter()
        .map(|input| truncate_chars(input, max_chars))
        .collect()
}

fn truncate_chars(input: String, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input;
    }
    input.chars().take(max_chars).collect()
}

fn embed_in_batches(
    embedder: Arc<Mutex<TextEmbedding>>,
    input: Vec<String>,
    batch_size: usize,
) -> Result<Vec<Vec<f32>>> {
    let mut output = Vec::with_capacity(input.len());
    let mut guard = embedder
        .lock()
        .map_err(|_| anyhow!("fastembed-rs embedder mutex poisoned"))?;

    for batch in input.chunks(batch_size) {
        let vectors = guard
            .embed(batch.to_vec(), Some(batch_size))
            .context("fastembed-rs failed to generate embeddings")?;
        for vector in vectors {
            if vector.len() != JINA_CODE_DIM {
                bail!(
                    "fastembed-rs returned dimension {}, expected {} for {JINA_CODE_MODEL}",
                    vector.len(),
                    JINA_CODE_DIM
                );
            }
            output.push(vector);
        }
    }

    if output.len() != input.len() {
        bail!(
            "fastembed-rs returned {} embeddings for {} inputs",
            output.len(),
            input.len()
        );
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_preserves_utf8_boundaries() {
        assert_eq!(truncate_chars("áβçd".to_string(), 3), "áβç");
    }

    #[test]
    fn truncate_chars_leaves_short_input_unchanged() {
        assert_eq!(truncate_chars("abc".to_string(), 10), "abc");
    }
}
