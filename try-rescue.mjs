#!/usr/bin/env node
/** rescue.js 를 실제 keyescape 탭에서 평가해 결과를 출력하는 소형 테스트 (예약 상태 변경 없음) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CDP_PORT || 9222);
const src = fs.readFileSync(path.join(DIR, 'rescue.js'), 'utf8');

const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
if (!ver) { console.error('CDP 없음. ./unlock.sh 를 먼저 실행하세요.'); process.exit(1); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 실패')); });
let seq = 0; const pend = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); } };
const raw = (method, params, sessionId) => new Promise((res, rej) => {
  const id = ++seq; const t = setTimeout(() => { pend.delete(id); rej(new Error(method + ' 시간 초과')); }, 8000);
  pend.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /keyescape\.com/i.test(t.url));
if (!page) { console.error('keyescape 탭 없음'); process.exit(1); }
const { sessionId } = await raw('Target.attachToTarget', { targetId: page.id, flatten: true });
const ev = async (expression) => {
  const r = await raw('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '예외');
  return r.result?.value;
};
console.log('탭 :', page.url.slice(0, 80));
console.log(' rescue 실행 :', await ev(src));
console.log(' 재확인      :', await ev(`(() => { const e = new MouseEvent('contextmenu',{bubbles:true,cancelable:true});
  document.body.dispatchEvent(e);
  return '디텍터=' + (window.devtoolsDetector && window.devtoolsDetector.addListener.name) +
         ' 우클릭prevent=' + e.defaultPrevented + ' onkeydown=' + typeof document.onkeydown; })()`));

/* ---------- --sandbox: 주입이 없는 페이지에서 사이트 차단을 흉내내고 rescue.js 로 풀기 ---------- */
if (process.argv.includes('--sandbox')) {
  const { targetId } = await raw('Target.createTarget', { url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 2500));
  const { sessionId: sid } = await raw('Target.attachToTarget', { targetId, flatten: true });
  const ev2 = async (expression) => {
    const r = await raw('Runtime.evaluate', { expression, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '예외');
    return r.result?.value;
  };
  const SITE = `(() => {
    window.devtoolsDetector = { addListener: function(){}, launch: function(){}, isDevToolsOpened: function(){ return true; } };
    document.onkeydown = function (e) { if (e.key === 'F12') e.preventDefault(); };
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    var e1 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e1);
    return '사이트 차단 설치: 우클릭prevent=' + e1.defaultPrevented + ' onkeydown=' + typeof document.onkeydown
         + ' 디텍터isOpened=' + window.devtoolsDetector.isDevToolsOpened();
  })()`;
  const AFTER = `(() => {
    var e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return 'rescue 후: 우클릭prevent=' + e.defaultPrevented + ' onkeydown=' + typeof document.onkeydown
         + ' 디텍터isOpened=' + window.devtoolsDetector.isDevToolsOpened()
         + ' launch=' + window.devtoolsDetector.launch.name;
  })()`;
  console.log(' [sandbox] 사이트 차단 :', await ev2(SITE));
  console.log(' [sandbox] rescue 실행 :', await ev2(src));
  console.log(' [sandbox] 결과        :', await ev2(AFTER));
  await raw('Target.closeTarget', { targetId });
}
ws.close();
