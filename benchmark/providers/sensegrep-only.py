#!/usr/bin/env python3
"""
Promptfoo custom provider: Claude Code with sensegrep-only
Uses headless mode: claude -p
"""

import sys
import json
import subprocess
import os

def main():
    # Read prompt from stdin (promptfoo convention)
    input_data = json.load(sys.stdin)
    prompt = input_data.get('prompt', '')

    # Get working directory from vars
    repo_name = input_data.get('vars', {}).get('repo_name', 'ciscoconfparse2')
    benchmark_root = os.path.dirname(os.path.dirname(__file__))
    working_dir = os.path.join(benchmark_root, 'repos', repo_name)

    # System prompt with sensegrep-only constraints
    system_prompt = f"""You are working in the repository: {repo_name}

IMPORTANT: You have access to the sensegrep MCP tool for semantic code search.
Use ONLY sensegrep for all code searches. DO NOT use grep, rg, ripgrep, or find commands.

The sensegrep tool supports:
- Semantic search by description (e.g., "functions that handle authentication")
- Filtering by symbol type (function, class, variable, etc.)
- Filtering by language features (isAsync, isExported, etc.)
- Metadata-based filtering (hasDocumentation, complexity, etc.)

Count and report how many sensegrep tool calls you executed.
At the end of your response, include:
- The file path and symbol name in the format: FILE:SYMBOL
- On a new line: "Tool calls: X" where X is the number of sensegrep calls you made."""

    # Set environment variable for sensegrep root
    env = os.environ.copy()
    env['SENSEGREP_ROOT'] = working_dir

    # Run claude in headless mode with auto-approved tools
    # Allow all tools (*) since we control behavior via system prompt
    result = subprocess.run(
        [
            'claude', '-p', prompt,
            '--append-system-prompt', system_prompt,
            '--allowedTools', '*'
        ],
        cwd=working_dir,
        capture_output=True,
        text=True,
        timeout=300,
        env=env
    )

    output = result.stdout

    # Try to extract tool call count
    tool_calls = 0
    if "Tool calls:" in output:
        try:
            tool_calls = int(output.split("Tool calls:")[-1].strip().split()[0])
        except:
            # Count sensegrep occurrences as fallback
            tool_calls = output.lower().count('sensegrep')

    # Return in promptfoo format
    response = {
        "output": output,
        "metadata": {
            "toolUses": [{"name": "sensegrep"}] * tool_calls  # Simulate tool use array
        }
    }

    print(json.dumps(response))

if __name__ == "__main__":
    main()
