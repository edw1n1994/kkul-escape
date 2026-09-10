#!/usr/bin/env node
/**
 * CDP(Chrome DevTools Protocol)로 크롬을 직접 제어해
 * keyescape.com 의 개발자도구 차단을 무력화하고, 실제로 해제되었는지 검증한다.
 *
 * 사용법:  ./start.sh &   →   node cdp-unlock.mjs [열고 싶은 URL]
 * Node 22+ 필요 (전역 WebSocket).
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const TARGET_URL = process.argv[2] ||
  'https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=58&theme_info_num=35';
const HERE = new URL('.', import.meta.url).pathname;
const SOURCE = fs.readFileSync(HERE + 'unlock.js', 'utf8');

// ---------- CDP 클라이언트 ----------
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !/^devtools:/.test(t.url));
if (!page) {
  console.error('페이지 타겟을 찾지 못했습니다. start.sh 를 먼저 실행하세요.');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onopen = () => {};
const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 접속 실패')); });

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else events.push(msg);
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (msg) => msg.error
    ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
    : resolve(msg.result));
  ws.send(JSON.stringify({ id, method, params }));
});

const waitForEvent = (method, ms = 20000) => new Promise((resolve) => {
  const tick = setInterval(() => {
    const e = events.find((x) => x.method === method);
    if (e) { clearInterval(tick); clearTimeout(to); resolve(e); }
  }, 80);
  const to = setTimeout(() => { clearInterval(tick); resolve(null); }, ms);
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

// ---------- 실행 ----------
await opened;
console.log('CDP 연결됨:', page.url);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// (1) devtools-detector 라이브러리 로드 자체를 네트워크에서 차단
await send('Network.setBlockedURLs', { patterns: ['*devtools-detector*'] });
// (2) 페이지 스크립트보다 먼저 도는 무력화 스크립트 주입 (우클릭/키보드 차단 대비 2중 안전)
const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: SOURCE });
console.log('주입 완료:', inj.identifier, '/ 요청 차단 패턴: *devtools-detector*');

events.length = 0;
await send('Page.navigate', { url: TARGET_URL });
await waitForEvent('Page.loadEventFired');
await new Promise((r) => setTimeout(r, 1500)); // 사이트 스크립트/앱 렌더 대기

// ---------- 검증 ----------
const report = await evaluate(`(() => {
  const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(ctx);

  const before = document.body.innerText.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 123, key: 'F12' }));
  const afterF12 = document.body.innerText.length;

  return {
    url: location.href,
    detectorType: typeof window.devtoolsDetector,
    detectorIsStub: !!(window.devtoolsDetector && typeof window.devtoolsDetector.launch === 'function'),
    libLoaded: performance.getEntriesByType('resource').some(r => /devtools-detector/.test(r.name)),
    onkeydownRegistered: typeof document.onkeydown,
    rightClickPrevented: ctx.defaultPrevented,
    wipedByBlackScreen: document.body.innerText.includes('금지'),
    f12Survived: afterF12 === before,
    datePickerItems: document.querySelectorAll('.selDate').length,
    timeButtons: document.querySelectorAll('.selThemeTimeNum').length,
    stepButtons: document.querySelectorAll('.btn_next_step').length,
    bodyPreview: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120)
  };
})()`);

console.log('\n===== 검증 결과 =====');
for (const [k, v] of Object.entries(report)) console.log(String(k).padEnd(22), ':', v);

const pass = report.detectorIsStub
  && report.onkeydownRegistered !== 'function'   // 사이트 키 차단기가 함수로 등록되면 안 됨 (null/undefined 정상)
  && report.rightClickPrevented === false
  && report.wipedByBlackScreen === false
  && report.f12Survived === true;
console.log('\n결과:', pass ? '✅ 개발자도구 차단 완전 해제' : '⚠️ 일부 미해제 — 로그 확인 필요');

ws.close();
process.exit(pass ? 0 : 2);
