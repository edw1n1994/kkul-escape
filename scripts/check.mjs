// Offline syntax checks. Never opens a browser or starts a reservation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', '.local', '.build-cache', 'node_modules', 'dist', 'runs']);
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
let checked = 0;
function check(command, args, label, input) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', input });
  if (result.error || result.status !== 0) {
    console.error(label, result.error?.message || result.stderr || result.stdout);
    process.exitCode = 1;
  } else checked++;
}
for (const file of files(root)) {
  if (file === path.join(root, 'tools/legacy/step1-page.js')) {
    // This file is an async function body, embedded by step1.mjs and flow.mjs.
    check(process.execPath, ['--check', '--input-type=commonjs'], path.relative(root, file),
      `(async () => {\n${fs.readFileSync(file, 'utf8')}\n})()`);
  } else if (/\.(mjs|cjs|js)$/.test(file)) check(process.execPath, ['--check', file], path.relative(root, file));
  if (file.endsWith('.sh') && process.platform !== 'win32') check('bash', ['-n', file], path.relative(root, file));
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kkul-check-'));
try {
  const html = fs.readFileSync(path.join(root, 'ui/public/index.html'), 'utf8');
  let index = 0;
  for (const [, attributes, script] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(attributes) || !script.trim()) continue;
    const file = path.join(temp, `inline-${index++}.js`);
    fs.writeFileSync(file, script);
    check(process.execPath, ['--check', file], 'ui/public/index.html inline script');
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`Syntax checks: ${checked} passed${process.platform === 'win32' ? ' (shell checks require bash on macOS/Linux)' : ''}`);
