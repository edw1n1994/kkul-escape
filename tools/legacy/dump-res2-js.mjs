#!/usr/bin/env node
/** reservation2 인라인 스크립트 텍스트를 모두 덤프 (읽기 전용) */
const PORT = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab) { console.error('탭 없음'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let seq = 0; const p = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && p.has(msg.id)) { p.get(msg.id)(msg); p.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
const r = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `[...document.querySelectorAll('script')].map(s=>s.textContent).filter(t=>t && t.trim()).join('\\n/* ==== inline script ==== */\\n')`,
});
console.log(r.result.value || '(인라인 스크립트 없음)');
ws.close();
