#!/usr/bin/env python3
"""
Generate promptfoo tests JSON from task directories
"""

import json
import os
from pathlib import Path

def main():
    benchmark_root = Path(__file__).parent.parent
    tasks_dir = benchmark_root / "tasks"

    tests = []

    # Iterate through task directories
    for task_dir in sorted(tasks_dir.glob("task*")):
        if not task_dir.is_dir():
            continue

        # Load metadata
        metadata_file = task_dir / "metadata.json"
        if not metadata_file.exists():
            print(f"Warning: No metadata.json in {task_dir.name}")
            continue

        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        # Load prompt
        prompt_file = task_dir / "prompt.txt"
        if not prompt_file.exists():
            print(f"Warning: No prompt.txt in {task_dir.name}")
            continue

        with open(prompt_file, 'r', encoding='utf-8') as f:
            prompt = f.read()

        # Create test entry
        test = {
            "description": f"{metadata['task_id']}: {metadata['repo_name']} - {metadata['ground_truth_symbol']}",
            "vars": {
                "repo_name": metadata["repo_name"],
                "task_description": metadata["task_description"],
                "ground_truth_file": metadata["ground_truth_file"],
                "ground_truth_symbol": metadata["ground_truth_symbol"]
            },
            "assert": [
                {
                    "type": "javascript",
                    "value": """
// Count total tool calls made by agent
const toolCalls = output.metadata?.toolUses?.length || 0;

// Score: lower calls = better (max 20 calls for full credit)
const score = Math.max(0, Math.min(1, (20 - toolCalls) / 20));

return {
  pass: toolCalls <= 20,
  score: score,
  reason: `Tool calls: ${toolCalls} (score: ${score.toFixed(2)})`
};
"""
                },
                {
                    "type": "llm-rubric",
                    "value": f"""The agent was asked to find the file and symbol for an import.

Task: {metadata['task_description']}
Ground truth: {metadata['ground_truth_file']}:{metadata['ground_truth_symbol']}
Agent response: {{{{ output }}}}

Scoring:
- 1.0: Agent found BOTH correct file AND correct symbol
- 0.6: Agent found correct file but wrong/missing symbol
- 0.3: Agent found related file but not the exact one
- 0.0: Agent did not find the correct code

Be lenient with path formats (relative vs absolute, slashes, etc.)
Symbol names must match (class/function name).""",
                    "threshold": 0.6
                },
                {
                    "type": "cost",
                    "threshold": 1.0
                },
                {
                    "type": "latency",
                    "threshold": 300000
                }
            ]
        }

        # Add the prompt at test level (promptfoo will pass it to providers)
        test["prompt"] = prompt

        tests.append(test)
        print(f"Added {task_dir.name}: {metadata['repo_name']} - {metadata['ground_truth_symbol']}")

    # Write tests JSON
    output_file = benchmark_root / "tests-pilot.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(tests, f, indent=2)

    print(f"\nGenerated {len(tests)} tests in {output_file}")

if __name__ == "__main__":
    main()
