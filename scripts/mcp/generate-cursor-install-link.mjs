#!/usr/bin/env node

function usage() {
  console.log(`generate-cursor-install-link

Usage:
  node scripts/mcp/generate-cursor-install-link.mjs [options]

Options:
  --name <server-name>      MCP server name (default: sensegrep)
  --package <npm-package>   npm package spec (default: @sensegrep/mcp@latest)
  --workspace-root          Include SENSEGREP_ROOT=\${workspaceFolder}
  --help                    Show this help
`)
}

function parseArgs(argv) {
  const options = {
    name: "sensegrep",
    pkg: "@sensegrep/mcp@latest",
    workspaceRoot: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--workspace-root") {
      options.workspaceRoot = true;
      continue;
    }
    if (arg === "--name") {
      options.name = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--package") {
      options.pkg = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const config = {
    command: "npx",
    args: ["-y", options.pkg],
  };

  if (options.workspaceRoot) {
    config.env = { SENSEGREP_ROOT: "${workspaceFolder}" };
  }

  const base64Config = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const url = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(options.name)}&config=${encodeURIComponent(base64Config)}`;

  console.log("Config JSON:");
  console.log(JSON.stringify(config, null, 2));
  console.log("");
  console.log("Cursor deeplink:");
  console.log(url);
  console.log("");
  console.log("Markdown:");
  console.log(`[Add ${options.name} MCP to Cursor](${url})`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
