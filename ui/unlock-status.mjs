#!/usr/bin/env node
/**
 * keyescape 탭의 DevTools 차단 3종 상태를 "읽기 전용"으로 검사 (주입/쓰기 없음)
 *
 *   node unlock-status.mjs [port]        JSON 출력
 *   CDP_PORT=9333 node unlock-status.mjs
 *
 * 종료코드  0 = 전부 해제됨(또는 keyescape 탭 없음) / 2 = 일부 차단 상태 / 3 = CDP 없음
 *
 * 검사 항목 (unlock.mjsVERIFY 와 동일 지표):
 *   dummy    : window.devtoolsDetector 가 우리 더미(addListener.name==='noop')인가
 *   ctxOpen  : contextmenu 이벤트가 preventDefault 되지 않는가 (우클릭/검사 가능)
 *   keyBlock : document.onkeydown 에 차단 함수가 걸려 있지 않은가 (F12 열림)
 */
const PORT = Number(process.argv[2] || process.env.CDP_PORT || 9222);
const out = (o, code) => { console.log(JSON.stringify(o, null, 2)); process.exit(code); };

const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2500) })
  .then((r) => r.json()).catch(() => null);
if (!ver) out({ ok: false, cdp: 'DOWN', port: PORT, tabs: [], allUnlocked: false, fix: `sh ui.sh --fix  또는  CDP_PORT=${PORT} ../unlock.sh` }, 3);

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2500) })
  .then((r) => r.json()).catch(() => []);
const pages = list.filter((t) => t.type === 'page' && /keyescape\.com/i.test(t.url));
if (!pages.length) {
  out({ ok: true, cdp: 'OK', port: PORT, browser: ver.Browser, tabs: [], allUnlocked: true, count: 0,
    note: 'keyescape 탭 없음 — 예약을 실행하면 열리고 그때 주입된다' }, 0);
}

/* 브라우저 레벨 WS 로 각 탭에 attach (주입 없이 evaluate 만) */
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('브라우저 WS 접속 실패')); });
let seq = 0; const pend = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq; const t = setTimeout(() => { pend.delete(id); rej(new Error(method + ' 응답 시간 초과')); }, 6000);
  pend.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const VERIFY = `(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  (document.body || document.documentElement).dispatchEvent(ev);
  const d = window.devtoolsDetector;
  return JSON.stringify({
    href: location.href.slice(0, 90),
    dummy: !!(d && d.addListener && d.addListener.name === 'noop'),
    ctxOpen: !ev.defaultPrevented,
    keyBlock: typeof document.onkeydown === 'function' ? '차단기 등록됨' : '미등록(F12 열림)',
    wiped: (document.body ? document.body.innerHTML.length : 0) < 400,
  });
})()`;

const tabs = [];
for (const t of pages) {
  const row = { url: t.url.slice(0, 90), unlocked: false, error: null };
  try {
    const { sessionId } = await send('Target.attachToTarget', { targetId: t.id, flatten: true });
    const r = await send('Runtime.evaluate', { expression: VERIFY, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error('평가가 예외 — 페이지이동 중?');
    const s = JSON.parse(r.result.value);
    Object.assign(row, s, { unlocked: s.dummy && s.ctxOpen && s.keyBlock.startsWith('미등록') && !s.wiped });
  } catch (e) { row.error = String(e.message).slice(0, 90); }
  tabs.push(row);
}
ws.close();
const all = tabs.every((t) => t.unlocked);
out({
  ok: all, cdp: 'OK', port: PORT, browser: ver.Browser, count: tabs.length, tabs, allUnlocked: all,
  fix: all ? null : `node ../unlock.mjs --quiet  (또는 sh ui.sh --fix)`,
}, all ? 0 : 2);
