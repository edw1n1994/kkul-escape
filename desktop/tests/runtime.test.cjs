const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { copyRuntime, browserCandidates } = require('../runtime.cjs');
const root = path.resolve(__dirname, '../..');

test('macOS bundle name uses the same Unicode normalization as packaged helper names', () => {
  const { build } = require('../../package.json');
  assert.equal(build.mac.extendInfo.CFBundleName, build.productName.normalize('NFD'));
});

test('runtime allowlist excludes personal files and preserves user cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkul-runtime-'));
  try {
    copyRuntime(root, dir);
    assert.ok(fs.existsSync(path.join(dir, 'ext/inject.js')));
    for (const file of ['ui/naver.mjs', 'ui/naver-browser.mjs', 'ui/naver-products.json']) assert.ok(fs.existsSync(path.join(dir, file)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ui/naver-products.json')))[0].name, '바야흐로,여름이었다.');
    for (const name of ['ui/local.env', 'ui/runs.log', 'step2-snapshot.json', 'MEMORY.md']) {
      assert.equal(fs.existsSync(path.join(dir, name)), false);
    }
    fs.writeFileSync(path.join(dir, 'ui/zw-open-times.json'), '{"custom":true}');
    copyRuntime(root, dir);
    assert.equal(fs.readFileSync(path.join(dir, 'ui/zw-open-times.json'), 'utf8'), '{"custom":true}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('browser detection covers Windows Chrome and Edge and user-installed macOS Chrome', () => {
  const windows = browserCandidates('win32', { PROGRAMFILES: 'C:/Program Files', LOCALAPPDATA: 'C:/Users/test/AppData/Local' });
  assert.equal(windows.length, 4);
  assert.ok(windows.some(p => p.endsWith('msedge.exe')));
  assert.ok(browserCandidates('darwin', { HOME: '/Users/test' }).some(p => p.startsWith('/Users/test/Applications/')));
});

test('server starts on an isolated port, serves UI and shuts down with an SSE connection', { timeout: 10000 }, async () => {
  const child = fork(path.join(root, 'ui/server.mjs'), [], {
    env: { ...process.env, PORT: '0', BIND: '127.0.0.1', CDP_PORT: '1' }, silent: true,
  });
  const exit = once(child, 'exit');
  try {
    const [message] = await Promise.race([
      once(child, 'message'),
      exit.then(([code]) => { throw new Error(`Server exited before ready: ${code}`); }),
    ]);
    assert.equal(message.type, 'ready');
    assert.ok(message.port > 0);
    const base = `http://127.0.0.1:${message.port}`;
    const page = await fetch(base).then(r => r.text());
    assert.match(page, /<html/);
    const events = await fetch(base + '/api/events');
    assert.equal(events.status, 200);
    child.send({ type: 'shutdown' });
    const [code] = await exit;
    assert.equal(code, 0);
    await events.body.cancel();
  } finally { if (child.exitCode === null) child.kill(); }
});
