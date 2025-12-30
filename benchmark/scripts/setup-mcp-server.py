#!/usr/bin/env python3
"""
Configure sensegrep MCP server in Claude Code settings for benchmark

This script adds the sensegrep MCP server to Claude Code's settings.yaml
so that sensegrep-only and hybrid providers can use semantic search.
"""

import os
import sys
import yaml
from pathlib import Path

def get_claude_settings_path():
    """Get path to Claude Code settings file"""
    home = Path.home()

    if sys.platform == "win32":
        settings_path = home / ".claude" / "settings.yaml"
    elif sys.platform == "darwin":
        settings_path = home / ".claude" / "settings.yaml"
    else:  # linux
        settings_path = home / ".claude" / "settings.yaml"

    return settings_path

def main():
    benchmark_root = Path(__file__).parent.parent
    # Benchmark is in a git worktree, main repo is in parent directory 'sensegrep'
    sensegrep_root = Path("C:/Users/stahl/Documents/sensegrep")
    mcp_server_path = sensegrep_root / "packages" / "mcp" / "dist" / "server.js"

    if not mcp_server_path.exists():
        print(f"ERROR: MCP server not found at {mcp_server_path}")
        print("Build the MCP server first with: npm run build")
        return 1

    settings_path = get_claude_settings_path()
    print(f"Claude Code settings: {settings_path}")

    # Load existing settings or create new
    if settings_path.exists():
        with open(settings_path, 'r', encoding='utf-8') as f:
            settings = yaml.safe_load(f) or {}
        print("Loaded existing settings")
    else:
        settings = {}
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        print("Creating new settings file")

    # Ensure mcpServers section exists
    if 'mcpServers' not in settings:
        settings['mcpServers'] = {}

    # Add or update sensegrep server
    sensegrep_config = {
        'command': 'node',
        'args': [str(mcp_server_path)],
        'env': {
            'SENSEGREP_ROOT': '.'  # Will be overridden by provider
        }
    }

    if 'sensegrep' in settings['mcpServers']:
        print("sensegrep MCP server already configured - updating...")
    else:
        print("Adding sensegrep MCP server configuration...")

    settings['mcpServers']['sensegrep'] = sensegrep_config

    # Write settings back
    with open(settings_path, 'w', encoding='utf-8') as f:
        yaml.dump(settings, f, default_flow_style=False, sort_keys=False)

    print(f"\nSUCCESS! sensegrep MCP server configured.")
    print(f"\nConfiguration:")
    print(f"  Command: node")
    print(f"  Script: {mcp_server_path}")
    print(f"\nThe benchmark providers can now use sensegrep for semantic search.")

    return 0

if __name__ == "__main__":
    try:
        import yaml
    except ImportError:
        print("ERROR: PyYAML not installed")
        print("Install with: pip install pyyaml")
        sys.exit(1)

    sys.exit(main())
