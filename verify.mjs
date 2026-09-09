#!/usr/bin/env node
/**
 * 현재 열려 있는 keyescape 탭에 접속해 차단이 실제로 죽어있는지 정밀 검증한다.
 *   - 스크립트 재실행(새로고침) 후에도 유지되는지
 *   - 주입된 devtoolsDetector 가 진짜인지(사이트 라이브러리가 덮어쓰지 못했는지)
 *   - DevTools UI 가 열린 상태에서 검은 화면으로 지워지지 않는지
 * 부가 결과로 페이지 스크린샷을 after.png 로 저장한다.
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!page) { console.error('keyescape 탭 없음'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else events.push(msg);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const waitEvent = (method, ms = 20000) => new Promise((res) => {
  const tick = setInterval(() => {
    const e = events.find((x) => x.method === method);
    if (e) { clearInterval(tick); clearTimeout(to); res(e); }
  }, 80);
  const to = setTimeout(() => { clearInterval(tick); res(null); }, ms);
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// 새로고침 후에도 유지되는지 확인
events.length = 0;
await send('Page.reload', { ignoreCache: true });
await waitEvent('Page.loadEventFired');
await new Promise((r) => setTimeout(r, 2000));

const detail = await ev(`(() => {
  const d = window.devtoolsDetector;
  const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(ctx);
  return {
    url: location.href,
    detectorKeys: d ? Object.keys(d).join(',') : '(없음)',
    launchSrc: d ? String(d.launch).replace(/\\s+/g, ' ').slice(0, 40) : '(없음)',
    isOurStub: !!(d && /^function\\s*\\(\\s*\\)\\s*\\{\\s*\\}$/.test(String(d.launch))),
    onkeydownType: typeof document.onkeydown,
    rightClickPrevented: ctx.defaultPrevented,
    wiped: document.body.innerText.includes('금지'),
    // 사이트가 남긴 실제 예약 UI 가 살아있는지
    themeSelected: !!document.querySelector('#theme')?.value,
    dateCells: document.querySelectorAll('.selDate').length,
    nextStepBtn: document.querySelectorAll('.btn_next_step').length
  };
})()`);

const blocked = events.filter((e) => e.method === 'Network.loadingFailed'
  && (e.params.blockedReason === 'blockedbyclient' || /devtools-detector/.test(e.params.errorText || '')));
const loadedLib = await ev(`performance.getEntriesByType('resource').filter(r => /devtools-detector/.test(r.name))
  .map(r => r.name + ' | transferSize=' + r.transferSize + ' | status=' + r.responseStatus)[0] || ' Resource Timing 없음'`);

// 스크린샷 저장
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(HERE + 'after.png', Buffer.from(shot.data, 'base64'));

console.log('===== 정밀 검증 (새로고침 이후) =====');
for (const [k, v] of Object.entries(detail)) console.log(String(k).padEnd(18), ':', v);
console.log('네트워크 차단 이벤트    :', blocked.length ? blocked.map(b => b.params.errorText).join(' / ') : '없음( stub 선점으로 대체)');
console.log('라이브러리 리소스 기록  :', loadedLib);
console.log('스크린샷               : after.png 저장됨');

const pass = detail.isOurStub && detail.onkeydownType !== 'function'
  && detail.rightClickPrevented === false && detail.wiped === false;
console.log('\n결과:', pass ? '✅ 차단 완전 해제 (DevTools 열린 상태 유지 확인)' : '⚠️ 확인 필요');
ws.close();
process.exit(pass ? 0 : 2);
