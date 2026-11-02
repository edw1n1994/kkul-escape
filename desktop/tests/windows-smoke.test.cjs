const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSmoke, validateSmoke } = require('../../scripts/windows-smoke.cjs');
const result = { browserRecovered: true, title: '예약도우미', inputs: 8, nodeExposed: false, naverTheme: '6627331' };
const marker = 'DESKTOP_SMOKE_OK ' + JSON.stringify(result);

test('success requires both a valid UI result and a clean exit', () => {
  assert.deepEqual(validateSmoke(marker + '\r\n', '', 0, null), result);
  for (const [stdout, stderr, code, signal] of [
    ['', '', 0, null], [marker, '', 1, null], [marker, '', null, 'SIGTERM'],
    [marker + '\n' + marker, '', 0, null], ['DESKTOP_SMOKE_OK {bad}', '', 0, null],
    [marker, 'DESKTOP_SMOKE_ERROR renderer failed', 0, null],
    [marker, 'Uncaught Exception: missing module', 0, null],
  ]) assert.throws(() => validateSmoke(stdout, stderr, code, signal));
  for (const change of [{ nodeExposed: true }, { browserRecovered: false }, { title: '' }, { inputs: 0 }, { naverTheme: 'wrong' }]) {
    assert.throws(() => validateSmoke('DESKTOP_SMOKE_OK ' + JSON.stringify({ ...result, ...change }), '', 0, null));
  }
});

test('process harness captures logs, strips Electron/Node overrides and rejects failures', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkul harness 한글 '));
  const fixture = path.join(dir, 'fake app.cjs');
  try {
    fs.writeFileSync(fixture, `
      if (!process.argv.includes('--desktop-smoke')) process.exit(10);
      if (process.env.ELECTRON_RUN_AS_NODE || process.env.NODE_OPTIONS || process.env.NODE_PATH) process.exit(11);
      if (!require('node:fs').existsSync(process.env.KKUL_SMOKE_TEMP)) process.exit(12);
      console.log(${JSON.stringify(marker)});
    `);
    const saved = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      const report = await runSmoke(process.execPath, { args: [fixture], output: path.join(dir, 'success') });
      assert.equal(report.ok, true);
      assert.match(fs.readFileSync(path.join(dir, 'success/stdout.log'), 'utf8'), /DESKTOP_SMOKE_OK/);
    } finally {
      if (saved === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = saved;
    }
    fs.writeFileSync(fixture, 'process.exit(0);');
    await assert.rejects(runSmoke(process.execPath, { args: [fixture], output: path.join(dir, 'missing') }), /Expected exactly one/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'missing/result.json'))).ok, false);
    fs.writeFileSync(fixture, `console.log(${JSON.stringify(marker)}); process.exit(7);`);
    await assert.rejects(runSmoke(process.execPath, { args: [fixture], output: path.join(dir, 'exit') }), /code=7/);
    fs.writeFileSync(fixture, 'setInterval(() => {}, 1000);');
    await assert.rejects(runSmoke(process.execPath, { args: [fixture], timeout: 300, output: path.join(dir, 'timeout') }), /timed out/);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
