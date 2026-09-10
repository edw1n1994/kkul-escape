#!/usr/bin/env node
/**
 * DevTools 가 열린 상태에서 예약 플로우가 실제로 동작하는지 스모크 테스트한다.
 * (날짜 셀 클릭 -> 시간대 목록 로드 되는지. 조회(GET) 만 수행하고 예약은 제출하지 않는다.)
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!page) { console.error('keyescape 탭 없음'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send('Runtime.enable');
console.log(await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};

  const cell = document.querySelectorAll('.selDate')[7];
  if (!cell) return { error: '날짜 셀을 찾지 못함' };
  out.clickedDate = cell.textContent.trim();
  cell.click();
  await sleep(2500);

  out.timesLoaded = document.querySelectorAll('.selThemeTimeNum').length;
  out.timeText = [...document.querySelectorAll('.selThemeTimeNum')].slice(0, 5).map(b => b.textContent.trim()).join(' | ');
  out.wiped = document.body.innerText.includes('금지');
  out.rightClickPrevented = (() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e); return e.defaultPrevented;
  })();
  out.detectorIsStub = String(window.devtoolsDetector?.launch).replace(/\\s+/g, ' ') === 'function () {}';
  return out;
})()`));
ws.close();
