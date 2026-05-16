---
"@sensegrep/core": patch
"@sensegrep/cli": patch
"@sensegrep/mcp": patch
---

Fix Amazon Bedrock authentication to prefer the configured API key token from sensegrep config files instead of falling back to expired AWS credentials.
