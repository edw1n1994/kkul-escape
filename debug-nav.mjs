#!/usr/bin/env node
/** 탭 상태/내비게이션 진단 */
const PORT = Number(process.env.CDP_PORT || 9222);
const URL1 = 'https://www.keyescape.com/reservation1.php?zizum_num=19&theme_num=60&theme_info_num=38';
const show = async (tag) => {
  const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  console.log('[' + tag + ']');
  l.filter((t) => t.type === 'page').forEach((t) => console.log('   ', t.url.slice(0, 100)));
  return l;
};
await show('before');
const l1 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = l1.find((t) => t.type === 'page' && /keyescape/.test(t.url));
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg.method); };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable');
const r = await send('Page.navigate', { url: URL1 });
console.log('navigate 응답:', JSON.stringify(r));
await new Promise((x) => setTimeout(x, 4000));
console.log('수신 이벤트:', events.join(','));
const loc = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
console.log('페이지 location:', loc.result?.value);
await send('Runtime.enable');
const st = await send('Runtime.evaluate', { expression: `({href:location.href, zizum: document.querySelector('#zizum')?.value, themeOpts: document.querySelector('#theme')?.options.length, ready: document.readyState})`, returnByValue: true });
console.log('상태:', JSON.stringify(st.result.value));
await show('after');
ws.close();
