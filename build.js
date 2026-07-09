#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const tsc = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'tsc');
const shebang = '#!/usr/bin/env node\n';

function packagePath(name, ...parts) {
  return path.join(rootDir, 'packages', name, ...parts);
}

function cleanPackageDist(name) {
  fs.rmSync(packagePath(name, 'dist'), { recursive: true, force: true });
}

function runTsc(name) {
  execSync(`"${tsc}" -p "${packagePath(name, 'tsconfig.json')}"`, {
    stdio: 'inherit',
    cwd: rootDir,
  });
}

function addShebang(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.startsWith('#!')) {
    content = shebang + content.split(/\r?\n/).slice(1).join('\n');
  } else {
    content = shebang + content;
  }
  fs.writeFileSync(filePath, content);
}

console.log('Building core...');
cleanPackageDist('core');
runTsc('core');

console.log('Copying tool file...');
fs.mkdirSync(packagePath('core', 'dist', 'tool'), { recursive: true });
fs.copyFileSync(
  packagePath('core', 'src', 'tool', 'sensegrep.txt'),
  packagePath('core', 'dist', 'tool', 'sensegrep.txt'),
);

console.log('Building cli...');
cleanPackageDist('cli');
runTsc('cli');

console.log('Adding shebang to cli...');
addShebang(packagePath('cli', 'dist', 'main.js'));

console.log('Building mcp...');
cleanPackageDist('mcp');
runTsc('mcp');

console.log('Adding shebang to mcp...');
addShebang(packagePath('mcp', 'dist', 'server.js'));

console.log('Building vscode extension...');
cleanPackageDist('vscode');
execSync('node build.js', {
  stdio: 'inherit',
  cwd: packagePath('vscode'),
});

console.log('Build complete!');
