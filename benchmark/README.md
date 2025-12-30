# SenseGrep vs Grep Benchmark

AI Code Agent benchmark comparing semantic search (sensegrep) vs traditional grep.

Based on **RepoBench-R** (ICLR 2024) - Repository-level code retrieval tasks.

## Goal

Prove that AI code agents using **sensegrep are 4x more efficient** than using only grep, measuring:
- **Tool calls** until finding relevant code
- **Task completion rate**
- **Cost** (tokens/dollars consumed)

## Setup

### Prerequisites

```bash
# Install dependencies
npm install -g promptfoo
pip install datasets pyyaml  # HuggingFace datasets + YAML parser

# Build sensegrep MCP server (in main repo)
cd ../../packages/mcp
npm run build
```

### 1. Configure MCP Server

```bash
cd benchmark
python scripts/setup-mcp-server.py
```

This configures sensegrep MCP server in Claude Code settings (~/.claude/settings.yaml).

### 2. Clone and Index Repositories

```bash
bash scripts/1-setup-repos.sh
```

This will:
- Clone ciscoconfparse2 and aitviewer-skel
- Index both repos with sensegrep (~6 minutes total)
- Show index statistics

### 3. Prepare Tasks

**Pilot (10 tasks):**
```bash
python scripts/2-prepare-tasks.py --pilot --num 10
python scripts/generate-tests-json.py  # Generate tests-pilot.json
```

**Full MVP (50 tasks):**
```bash
python scripts/2-prepare-tasks.py --full --num 50
python scripts/generate-tests-json.py  # Generate tests-mvp.json
```

This converts RepoBench-R tasks to promptfoo format in `tasks/` directory.

## Running the Benchmark

### Pilot Run (10 tasks)

```bash
# Run 10 tasks × 3 providers = 30 Claude Code sessions
promptfoo eval --config promptfooconfig-pilot.yaml

# View interactive dashboard
promptfoo view

# Analyze results
ts-node scripts/3-analyze-results.ts results/pilot.json
```

Expected runtime: ~15-30 minutes (depends on task complexity)

### Full MVP Run (50 tasks)

```bash
# Run 50 tasks × 3 providers = 150 Claude Code sessions
promptfoo eval --config promptfooconfig.yaml --verbose

# View results
promptfoo view

# Generate report
ts-node scripts/3-analyze-results.ts results/mvp.json > results/analysis/mvp-report.txt
```

Expected runtime: ~2-3 hours

## Provider Configurations

All providers use **Claude Code headless mode** (`claude -p`) with your subscription:

1. **grep-only** (`providers/grep-only.py`):
   - Baseline using native grep/rg/find via Bash tool
   - No MCP servers, no semantic search
   - `--allowedTools "Bash,Read,Grep"`

2. **sensegrep-only** (`providers/sensegrep-only.py`):
   - Uses sensegrep MCP exclusively
   - Semantic search by description, filters, metadata
   - `--allowedTools "*"` (controlled via system prompt)

3. **hybrid** (`providers/hybrid.py`):
   - Both grep and sensegrep available
   - Agent chooses optimal tool per search
   - `--allowedTools "*"` (agent decides strategy)

## Metrics

**Primary:** Tool calls (fewer = better)
**Secondary:** Completion rate, cost, latency

**Success Criteria (MVP):**
- ✅ ≥2x tool call reduction
- ✅ ≥15pp completion improvement
- ✅ Cost reduction

## Directory Structure

```
benchmark/
├── repos/                      # Cloned repositories
│   ├── ciscoconfparse2/
│   └── aitviewer-skel/
├── tasks/                      # Generated from RepoBench-R
│   ├── task001/
│   │   ├── prompt.txt
│   │   └── metadata.json
│   └── ...
├── scripts/
│   ├── 1-setup-repos.sh       # Clone + index
│   ├── 2-prepare-tasks.py     # RepoBench → promptfoo
│   └── 3-analyze-results.ts   # Generate report
├── results/
│   ├── pilot.json
│   ├── mvp.json
│   └── analysis/
├── promptfooconfig.yaml       # Main benchmark config
└── README.md
```

## Troubleshooting

**Error: datasets not found**
```bash
pip install datasets pyyaml
```

**Error: sensegrep MCP not found**
```bash
# Build MCP server in main repo
cd C:\Users\stahl\Documents\sensegrep\packages\mcp
npm run build

# Configure in Claude Code settings
cd C:\Users\stahl\Documents\sensegrep-benchmark\benchmark
python scripts/setup-mcp-server.py
```

**Error: promptfoo command not found**
```bash
npm install -g promptfoo
```

**Error: claude command not found**
```bash
# Install Claude Code CLI
# See: https://code.claude.com/docs/install
```

**Custom provider returns empty output**
- Check that the working directory exists: `benchmark/repos/{repo_name}`
- Verify MCP server is built and configured
- Test manually: `claude -p "Find DynamicAddressException" --allowedTools "*"`

## Next Steps

1. ✅ Run pilot (10 tasks)
2. ✅ Validate results manually
3. ✅ Run full MVP (50 tasks)
4. ✅ Analyze and decide: proceed to extended benchmark?
5. 📊 Publish results + blog post

## References

- [RepoBench-R](https://github.com/Leolty/repobench) - ICLR 2024
- [Promptfoo Docs](https://www.promptfoo.dev/)
- [Plan](../docs/benchmark-plan.md) - Full implementation plan
