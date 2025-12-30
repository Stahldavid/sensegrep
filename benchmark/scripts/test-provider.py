#!/usr/bin/env python3
"""
Test a single provider with task001

Usage:
  python scripts/test-provider.py grep-only
  python scripts/test-provider.py sensegrep-only
  python scripts/test-provider.py hybrid
"""

import sys
import json
import subprocess
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python test-provider.py <provider-name>")
        print("  grep-only | sensegrep-only | hybrid")
        return 1

    provider = sys.argv[1]
    benchmark_root = Path(__file__).parent.parent

    # Load task001
    task_dir = benchmark_root / "tasks" / "task001"
    with open(task_dir / "prompt.txt", 'r', encoding='utf-8') as f:
        prompt = f.read()

    with open(task_dir / "metadata.json", 'r', encoding='utf-8') as f:
        metadata = json.load(f)

    # Create input for provider
    provider_input = {
        "prompt": prompt,
        "vars": {
            "repo_name": metadata["repo_name"],
            "task_description": metadata["task_description"],
            "ground_truth_file": metadata["ground_truth_file"],
            "ground_truth_symbol": metadata["ground_truth_symbol"]
        }
    }

    print(f"Testing provider: {provider}")
    print(f"Task: {metadata['task_id']}")
    print(f"Repo: {metadata['repo_name']}")
    print(f"Ground truth: {metadata['ground_truth_file']}:{metadata['ground_truth_symbol']}")
    print("-" * 80)

    # Run provider
    provider_script = benchmark_root / "providers" / f"{provider}.py"
    if not provider_script.exists():
        print(f"ERROR: Provider script not found: {provider_script}")
        return 1

    result = subprocess.run(
        ["python", str(provider_script)],
        input=json.dumps(provider_input),
        capture_output=True,
        text=True,
        timeout=300
    )

    if result.returncode != 0:
        print(f"ERROR: Provider failed with exit code {result.returncode}")
        print(f"STDERR: {result.stderr}")
        return 1

    # Parse output
    try:
        response = json.loads(result.stdout)
        output = response.get("output", "")
        tool_calls = len(response.get("metadata", {}).get("toolUses", []))

        print(f"\nRESPONSE:")
        print(output)
        print(f"\n{'=' * 80}")
        print(f"Tool calls: {tool_calls}")
        print(f"Ground truth: {metadata['ground_truth_file']}:{metadata['ground_truth_symbol']}")

        # Check if response contains expected symbols
        if metadata['ground_truth_file'] in output and metadata['ground_truth_symbol'] in output:
            print("[OK] Response contains expected file and symbol!")
        else:
            print("[WARN] Response might be incorrect")

    except json.JSONDecodeError:
        print(f"ERROR: Failed to parse provider output as JSON")
        print(f"OUTPUT: {result.stdout}")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
