---
"@sensegrep/core": minor
"@sensegrep/cli": minor
"@sensegrep/mcp": minor
---

Add proactive rate limiting and exponential backoff retry for embedding requests

- Rate limiter (sliding window, 1 min) prevents 429s before they happen. Defaults match Gemini free tier: 3,000 RPM and 1,000,000 TPM.
- Automatic retry with exponential backoff + jitter on 429 responses (6 retries, base delay 1s, max 60s).
- Fully configurable per user via `~/.config/sensegrep/config.json` (`rateLimit.rpm`, `rateLimit.tpm`, `rateLimit.maxRetries`, `rateLimit.retryBaseDelayMs`) or env vars (`SENSEGREP_RATE_LIMIT_RPM`, `SENSEGREP_RATE_LIMIT_TPM`, `SENSEGREP_MAX_RETRIES`, `SENSEGREP_RETRY_BASE_DELAY_MS`).
