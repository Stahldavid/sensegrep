#!/usr/bin/env python3
"""Generate promptfoo tests array from task metadata"""

import json
from pathlib import Path

tasks_dir = Path("tasks")
tests = []

for task_dir in sorted(tasks_dir.glob("task*")):
    if not task_dir.is_dir():
        continue

    metadata_file = task_dir / "metadata.json"
    if not metadata_file.exists():
        continue

    with open(metadata_file) as f:
        metadata = json.load(f)

    tests.append({
        "vars": {
            "task_id": metadata["task_id"],
            "repo_name": metadata["repo_name"],
            "ground_truth_file": metadata["ground_truth_file"],
            "ground_truth_symbol": metadata["ground_truth_symbol"],
            "task_description": metadata["task_description"]
        }
    })

print(json.dumps(tests, indent=2))
