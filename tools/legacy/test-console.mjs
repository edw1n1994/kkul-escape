#!/usr/bin/env node
/** console-fill.js 가 콘솔 경로로도 동작하는지 CDP 로 검증 (제출 없음) */
import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const SRC = fs.readFileSync(HERE + 'console-fill.js', 'utf8');

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');

// reservation1 의 다른 테마로 되돌아가 콘솔 경로 재현
await send('Page.navigate', { url: 'https://www.keyescape.com/reservation1.php?zizum_num=25&theme_num=73&theme_info_num=66' });
await new Promise((r) => setTimeout(r, 4000));

console.log('--- console-fill.js 로드 ---');
console.log(await ev(SRC + "\n; 'loaded: ' + typeof window.KEY"));

console.log('--- KEY 호출 (submit:false) ---');
const out = await ev(`KEY({zizum:22, theme:65, date:'2026-09-08', submit:false})`);
console.log(JSON.stringify(out, null, 2));
ws.close();
