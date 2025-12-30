#!/usr/bin/env python3
"""
Promptfoo custom provider: Claude Code with hybrid (grep + sensegrep)
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

    # System prompt with hybrid approach guidance
    system_prompt = f"""You are working in the repository: {repo_name}

IMPORTANT: You have access to BOTH sensegrep (semantic search) and grep/rg (exact search) tools.
Choose the most efficient tool for each search.

Use sensegrep when:
- Finding code by description or intent (e.g., "functions that validate user input")
- Searching by structure or behavior
- You don't know the exact symbol name
- Looking for code patterns or idioms

Use grep/rg when:
- You know the exact literal string to find
- Searching for specific error messages, constants, or identifiers
- The search term is a precise token or phrase

Optimize for efficiency: fewer, more targeted searches are better than many broad searches.

Count and report total tool calls made.
At the end of your response, include:
- The file path and symbol name in the format: FILE:SYMBOL
- On a new line: "Tool calls: X" where X is the total number of search commands you ran."""

    # Set environment variable for sensegrep root
    env = os.environ.copy()
    env['SENSEGREP_ROOT'] = working_dir

    # Run claude in headless mode with auto-approved tools
    # Allow all tools (*) since agent chooses strategy
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
            # Count tool occurrences as fallback
            grep_calls = output.lower().count('grep') + output.lower().count('rg ')
            sensegrep_calls = output.lower().count('sensegrep')
            tool_calls = grep_calls + sensegrep_calls

    # Return in promptfoo format
    response = {
        "output": output,
        "metadata": {
            "toolUses": [{"name": "search"}] * tool_calls  # Simulate tool use array
        }
    }

    print(json.dumps(response))

if __name__ == "__main__":
    main()
