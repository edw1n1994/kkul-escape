// Uses only our local UI and preview runner; no live reservation buttons are pressed.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { cdp, sleep } from '../lib.mjs';
const port = Number(process.env.CDP_PORT || 9222);
const host = `http://127.0.0.1:${port}`;
const server = fork(fileURLToPath(new URL('../server.mjs', import.meta.url)), [], {
  env: { ...process.env, PORT: '0', BIND: '127.0.0.1', CDP_PORT: '1' }, silent: true,
});
let tab, c;
const exited = once(server, 'exit');
try {
  const [{ port: uiPort }] = await Promise.race([once(server, 'message'), exited.then(() => { throw new Error('Test server exited'); })]);
  const origin = `http://127.0.0.1:${uiPort}`;
  const env = await fetch(origin + '/api/env?site=naver').then(r => r.json());
  assert.ok(env.sites.some(s => s.key === 'naver')); assert.equal(env.branches[0].num, '843881');
  tab = await fetch(host + '/json/new?about%3Ablank', { method: 'PUT' }).then(r => r.json());
  c = cdp(tab.webSocketDebuggerUrl); await c.ready;
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('ke.site','naver');" });
  await c.send('Page.navigate', { url: origin });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await c.evaluate(`({tabs:document.getElementById('siteTabs')?.textContent,theme:document.getElementById('theme')?.value,chips:document.querySelectorAll('.chip').length})`).catch(() => null);
    if (state?.theme === '6627331' && state.chips > 0) break;
    await sleep(100);
  }
  assert.match(state.tabs, /네이버 예약/); assert.equal(state.theme, '6627331'); assert.ok(state.chips > 0);
  assert.equal(await c.evaluate("document.getElementById('naverOpen').style.display"), '');
  assert.equal(await c.evaluate("document.getElementById('nameWrap').style.display"), 'none');
  assert.equal(await c.evaluate("document.getElementById('autosubLabel').textContent"), '신청서까지 자동 진행');
  await c.evaluate("pickDate('2026-09-16', true); 'ok'");
  for (let i = 0; i < 50; i++) {
    if (await c.evaluate("!!document.querySelector('.chip[data-t=\"19:20\"]')")) break;
    await sleep(100);
  }
  assert.equal(await c.evaluate("!!document.querySelector('.chip[data-t=\"19:20\"]')"), true);
  await c.evaluate("pickTime('19:20'); fire(true); 'ok'");
  let log;
  for (let i = 0; i < 50; i++) {
    log = await fetch(origin + '/api/log').then(r => r.json());
    if (!log.running && log.lines.some(s => s.includes('[PREVIEW]'))) break;
    await sleep(100);
  }
  assert.ok(log.lines.some(s => s.includes('[PREVIEW]'))); assert.equal(log.exit, '성공 종료');
  const bad = await fetch(origin + '/api/run', { method: 'POST', body: JSON.stringify({ site: 'naver', zizum: '843881', theme: '6627331', date: '2026-02-30', dry: true }) }).then(r => r.json());
  assert.equal(bad.ok, false);
  console.log('NAVER_UI_OK: tab, business/theme, date/time, account UI, preview dispatch and invalid-date rejection');
} finally {
  c?.ws.close();
  if (tab) await fetch(host + '/json/close/' + tab.id).catch(() => {});
  if (server.exitCode === null) { server.send({ type: 'shutdown' }); await exited; }
}
