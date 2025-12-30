#!/usr/bin/env python3
"""
Promptfoo custom provider: Claude Code with grep-only
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

    # System prompt with tool constraints
    system_prompt = f"""You are working in the repository: {repo_name}

IMPORTANT: Use ONLY native grep, rg (ripgrep), or find commands via Bash tool for searching.
DO NOT use any MCP tools or semantic search capabilities.

Count and report how many search commands you executed.
At the end of your response, include:
- The file path and symbol name in the format: FILE:SYMBOL
- On a new line: "Tool calls: X" where X is the number of grep/rg/find commands you ran."""

    # Run claude in headless mode with auto-approved tools
    result = subprocess.run(
        [
            'claude', '-p', prompt,
            '--append-system-prompt', system_prompt,
            '--allowedTools', 'Bash,Read,Grep'
        ],
        cwd=working_dir,
        capture_output=True,
        text=True,
        timeout=300
    )

    output = result.stdout

    # Try to extract tool call count
    tool_calls = 0
    if "Tool calls:" in output:
        try:
            tool_calls = int(output.split("Tool calls:")[-1].strip().split()[0])
        except:
            # Count grep/rg occurrences as fallback
            tool_calls = output.lower().count('grep') + output.lower().count('rg ') + output.lower().count('find ')

    # Return in promptfoo format
    response = {
        "output": output,
        "metadata": {
            "toolUses": [{"name": "grep"}] * tool_calls  # Simulate tool use array
        }
    }

    print(json.dumps(response))

if __name__ == "__main__":
    main()
