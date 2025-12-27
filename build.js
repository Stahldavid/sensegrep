#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const tsc = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'tsc');

console.log('Building core...');
execSync(`${tsc} -p ${path.join(rootDir, 'packages', 'core', 'tsconfig.json')}`, {
  stdio: 'inherit',
  cwd: rootDir,
});

console.log('Copying tool file...');
fs.mkdirSync(path.join(rootDir, 'packages', 'core', 'dist', 'tool'), { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'packages', 'core', 'src', 'tool', 'sensegrep.txt'),
  path.join(rootDir, 'packages', 'core', 'dist', 'tool', 'sensegrep.txt'),
);

console.log('Building cli...');
execSync(`${tsc} -p ${path.join(rootDir, 'packages', 'cli', 'tsconfig.json')}`, {
  stdio: 'inherit',
  cwd: rootDir,
});

console.log('Adding shebang to cli...');
const cliPath = path.join(rootDir, 'packages', 'cli', 'dist', 'main.js');
const shebang = '#!/usr/bin/env node\n';
let cliContent = fs.readFileSync(cliPath, 'utf8');
if (cliContent.startsWith('#!')) {
  cliContent = shebang + cliContent.split(/\r?\n/).slice(1).join('\n');
} else {
  cliContent = shebang + cliContent;
}
fs.writeFileSync(cliPath, cliContent);

console.log('Building mcp...');
execSync(`${tsc} -p ${path.join(rootDir, 'packages', 'mcp', 'tsconfig.json')}`, {
  stdio: 'inherit',
  cwd: rootDir,
});

console.log('Adding shebang to mcp...');
const mcpPath = path.join(rootDir, 'packages', 'mcp', 'dist', 'server.js');
let mcpContent = fs.readFileSync(mcpPath, 'utf8');
if (mcpContent.startsWith('#!')) {
  mcpContent = shebang + mcpContent.split(/\r?\n/).slice(1).join('\n');
} else {
  mcpContent = shebang + mcpContent;
}
fs.writeFileSync(mcpPath, mcpContent);

console.log('Build complete!');
