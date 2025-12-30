#!/usr/bin/env python3
"""
Convert RepoBench-R dataset to promptfoo format

Usage:
  python 2-prepare-tasks.py --pilot --num 10    # Create 10 pilot tasks
  python 2-prepare-tasks.py --full --num 50     # Create 50 MVP tasks
"""

import json
import os
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Prepare RepoBench-R tasks for promptfoo")
    parser.add_argument("--pilot", action="store_true", help="Pilot mode (fewer tasks)")
    parser.add_argument("--full", action="store_true", help="Full MVP mode")
    parser.add_argument("--num", type=int, required=True, help="Total number of tasks")
    args = parser.parse_args()

    try:
        from datasets import load_dataset
    except ImportError:
        print("ERROR: 'datasets' library not installed")
        print("Run: pip install datasets")
        return 1

    print("Loading RepoBench-R dataset...")
    # Load all splits and combine them
    dataset_cff = load_dataset("tianyang/repobench_python_v1.1", split="cross_file_first")
    dataset_cfr = load_dataset("tianyang/repobench_python_v1.1", split="cross_file_random")
    dataset_inf = load_dataset("tianyang/repobench_python_v1.1", split="in_file")

    # Combine all splits
    from datasets import concatenate_datasets
    dataset = concatenate_datasets([dataset_cff, dataset_cfr, dataset_inf])

    # Filter for our 2 repos
    repos = ["mpenning/ciscoconfparse2", "MarilynKeller/aitviewer-skel"]
    print(f"Filtering for repos: {repos}")

    all_tasks = []
    for item in dataset:
        if item["repo_name"] in repos:
            all_tasks.append(item)

    print(f"Found {len(all_tasks)} total tasks from target repos")

    # Sample tasks (stratified by repo and level if possible)
    tasks_per_repo = args.num // 2
    selected = []

    for repo in repos:
        repo_tasks = [t for t in all_tasks if t["repo_name"] == repo]
        print(f"  {repo}: {len(repo_tasks)} tasks available")

        # Try to stratify by level
        levels = set(t.get("level", "unknown") for t in repo_tasks)
        print(f"    Levels: {sorted(levels)}")

        tasks_per_level = tasks_per_repo // len(levels) if levels else tasks_per_repo

        for level in sorted(levels):
            level_tasks = [t for t in repo_tasks if t.get("level") == level]
            selected.extend(level_tasks[:tasks_per_level])

        # Fill remaining if we didn't get enough
        if len([t for t in selected if t["repo_name"] == repo]) < tasks_per_repo:
            remaining = tasks_per_repo - len([t for t in selected if t["repo_name"] == repo])
            unselected = [t for t in repo_tasks if t not in selected]
            selected.extend(unselected[:remaining])

    print(f"\nSelected {len(selected)} tasks")

    # Create task directories
    benchmark_root = Path(__file__).parent.parent
    tasks_dir = benchmark_root / "tasks"
    tasks_dir.mkdir(exist_ok=True)

    print(f"Creating task directories in {tasks_dir}")

    for i, task in enumerate(selected, 1):
        task_id = f"task{i:03d}"
        task_dir = tasks_dir / task_id
        task_dir.mkdir(exist_ok=True)

        # Extract ground truth
        gold_idx = task.get("gold_snippet_index", 0)
        context = task.get("context", [])
        ground_truth_file = context[gold_idx]["path"] if context else "unknown"
        ground_truth_symbol = context[gold_idx]["identifier"] if context else "unknown"

        # Create prompt.txt
        prompt = f"""Find the code definition for the following import:

File: {task.get("file_path", "unknown")}
Next line: {task.get("next_line", "")}
Import: {task.get("import_statement", "")}

Which file and symbol contains the definition that will be imported?
Respond with: FILE:SYMBOL"""

        with open(task_dir / "prompt.txt", "w", encoding="utf-8") as f:
            f.write(prompt)

        # Create metadata.json
        metadata = {
            "task_id": task_id,
            "repo_name": task["repo_name"].split("/")[-1],
            "level": task.get("level", "unknown"),
            "ground_truth_file": ground_truth_file,
            "ground_truth_symbol": ground_truth_symbol,
            "task_description": f"Find definition for {task.get('import_statement', '')}",
            "original_task": {
                "file_path": task.get("file_path"),
                "next_line": task.get("next_line"),
                "import_statement": task.get("import_statement")
            }
        }

        with open(task_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

    print(f"Created {len(selected)} task directories")
    print(f"\nNext steps:")
    print(f"  1. Review tasks in: {tasks_dir}")
    print(f"  2. Run: promptfoo eval --config benchmark/promptfooconfig.yaml")

    return 0

if __name__ == "__main__":
    exit(main())
