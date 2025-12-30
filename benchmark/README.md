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
pip install datasets  # HuggingFace datasets for RepoBench-R

# Build sensegrep MCP server
cd ../../packages/mcp
npm run build
```

### 1. Clone and Index Repositories

```bash
cd benchmark
bash scripts/1-setup-repos.sh
```

This will:
- Clone ciscoconfparse2 and aitviewer-skel
- Index both repos with sensegrep
- Show index statistics

### 2. Prepare Tasks

**Pilot (10 tasks):**
```bash
python scripts/2-prepare-tasks.py --pilot --num 10
```

**Full MVP (50 tasks):**
```bash
python scripts/2-prepare-tasks.py --full --num 50
```

This converts RepoBench-R tasks to promptfoo format in `tasks/` directory.

## Running the Benchmark

### Pilot Run

```bash
# Run 10 tasks × 3 providers = 30 executions
promptfoo eval --config promptfooconfig.yaml --output results/pilot.json

# View interactive dashboard
promptfoo view

# Analyze results
ts-node scripts/3-analyze-results.ts results/pilot.json
```

### Full MVP Run

```bash
# Run 50 tasks × 3 providers = 150 executions
promptfoo eval --config promptfooconfig.yaml --output results/mvp.json --verbose

# View results
promptfoo view

# Generate report
ts-node scripts/3-analyze-results.ts results/mvp.json > results/analysis/mvp-report.txt
```

## Configurations

1. **grep-only**: Baseline (no MCP, uses native grep/rg/find)
2. **sensegrep-only**: Uses sensegrep MCP exclusively
3. **hybrid**: Both available, agent chooses

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
pip install datasets
```

**Error: sensegrep MCP not found**
```bash
cd ../../packages/mcp
npm run build
```

**Error: promptfoo command not found**
```bash
npm install -g promptfoo
```

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
