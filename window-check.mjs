#!/usr/bin/env node
/** 크롬 창(윈도우) 상태 확인: 타겟 목록 + 창 크기/상태 + DevTools 도킹 여부 */
const PORT = Number(process.env.CDP_PORT || 9222);
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const p = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && p.has(g.id)) { p.get(g.id)(g); p.delete(g.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === 'page' && !/^devtools:/.test(t.url));
const devtools = targets.filter((t) => /devtools:\/\/devtools/.test(t.url));
console.log('페이지 타겟 :', pages.length);
pages.forEach((t) => console.log('   -', t.url.slice(0, 78)));
console.log('DevTools 타겟:', devtools.length);

for (const t of pages) {
  try {
    const { windowId } = await send('Browser.getWindowForTarget', { targetId: t.id });
    const b = await send('Browser.getWindowBounds', { windowId });
    const { left, top, width, height } = b.bounds;
    console.log(`창 #${windowId}: ${width}x${height} @ (${left},${top}) 상태=${b.bounds.windowState || 'normal'}`);
  } catch (e) { console.log('창 정보 조회 실패:', e.message.slice(0, 80)); }
}
try {
  const { windows } = await send('Browser.getWindowForTarget', {}).catch(() => ({ windows: null }));
  if (windows) console.log('전체 창:', JSON.stringify(windows));
} catch (e) { /* ignore */ }
ws.close();
