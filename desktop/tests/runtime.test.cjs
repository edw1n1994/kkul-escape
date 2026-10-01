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
    for (const file of ['ui/recaptcha-click.mjs', 'ui/naver.mjs', 'ui/naver-browser.mjs', 'ui/naver-products.json', 'ui/public/classic.html', 'ui/public/app.js', 'ui/public/guided.js', 'ui/public/guided.css']) assert.ok(fs.existsSync(path.join(dir, file)));
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
    assert.match(page, /guided.js/);
    for (const file of ['classic.html', 'app.js', 'guided.js', 'guided.css']) {
      const response = await fetch(base + '/' + file); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
    }
    assert.equal((await fetch(base + '/local.env')).status, 404);
    const events = await fetch(base + '/api/events');
    assert.equal(events.status, 200);
    child.send({ type: 'shutdown' });
    const [code] = await exit;
    assert.equal(code, 0);
    await events.body.cancel();
  } finally { if (child.exitCode === null) child.kill(); }
});

test('desktop reconnect changes the runner port, ignores stale UI ports and blocks a run on recovery failure', { timeout: 15000 }, async () => {
  const http = require('node:http');
  const mockBrowser = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('[]'); });
  mockBrowser.listen(0, '127.0.0.1'); await once(mockBrowser, 'listening');
  const newPort = mockBrowser.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkul-reconnect-'));
  copyRuntime(root, dir);
  // Replace only the isolated test runner. Never drive a live reservation.
  fs.writeFileSync(path.join(dir, 'ui/runner.mjs'), 'console.log("TEST_PORT=" + process.argv[process.argv.indexOf("--port") + 1]);');
  const child = fork(path.join(dir, 'ui/server.mjs'), [], {
    env: { ...process.env, DESKTOP_APP: '1', PORT: '0', BIND: '127.0.0.1', CDP_PORT: '1' }, silent: true,
  });
  const exit = once(child, 'exit');
  let requests = 0, failure = false, pending, hold = false;
  child.on('message', message => {
    if (message.type !== 'browser:ensure') return;
    requests++;
    if (hold) { pending = message; return; }
    child.send({ type: 'browser:ready', id: message.id, ...(failure ? { error: '테스트 연결 실패' } : { port: newPort }) });
  });
  try {
    const [ready] = await once(child, 'message');
    const base = `http://127.0.0.1:${ready.port}`;
    const post = (route, body) => fetch(base + route, { method: 'POST', body: body && JSON.stringify(body) }).then(r => r.json());
    const connected = await post('/api/browser/reconnect');
    assert.equal(connected.port, newPort);
    const env = await fetch(base + '/api/env?site=naver&cdp=1').then(r => r.json());
    assert.equal(env.desktop, true); assert.equal(env.cdp_port, newPort); assert.equal(env.cdp, 'OK');
    const body = { site: 'keyescape', zizum: '1', theme: '1', info: '1', date: '2030-01-01', times: '12:00', cdp: 1 };
    const started = await post('/api/run', body);
    assert.equal(started.ok, true);
    let logs;
    for (let i = 0; i < 50; i++) {
      logs = await fetch(base + '/api/log').then(r => r.json());
      if (!logs.running) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(logs.lines.includes('TEST_PORT=' + newPort));
    failure = true;
    const failed = await post('/api/run', body);
    assert.equal(failed.ok, false); assert.equal(failed.msg, '테스트 연결 실패');
    assert.equal(requests, 3);
    failure = false; hold = true;
    const waiting = post('/api/run', body);
    for (let i = 0; i < 50 && !pending; i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(pending);
    assert.equal((await post('/api/run', body)).ok, false);
    assert.equal((await post('/api/stop')).ok, true);
    child.send({ type: 'browser:ready', id: pending.id, port: newPort });
    assert.match((await waiting).msg, /취소/);
  } finally {
    child.send({ type: 'shutdown' }); await exit;
    mockBrowser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
