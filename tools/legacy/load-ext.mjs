#!/usr/bin/env node
/**
 * CDP 브라우저 타겟에 접속해 unpacked 확장(ext/)을 프로필에 설치하고,
 * 열려 있는 keyescape 탭을 새로고침해 content script 를 적용한다.
 * (--load-extension 은 Chrome 152 에서 무시되어 이 방식을 사용한다.)
 * 설치된 확장은 프로필에 남아 재시작 후에도 유지된다.
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const EXT_PATH = new URL('../../ext/', import.meta.url).pathname;
const TARGET_URL = process.argv[2] || process.env.KEYESCAPE_URL ||
  'https://www.keyescape.com/reservation1.php?zizum_num=18&theme_num=58&theme_info_num=35';

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('브라우저 접속 실패')); });

let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});

const r = await send('Extensions.loadUnpacked', { path: EXT_PATH });
console.log('확장 설치됨:', JSON.stringify(r));
ws.close();

// keyescape 탭을 찾아 없으면 새로 연다 -> content script 적용
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let tabs = list.filter((t) => t.type === 'page' && /keyescape/.test(t.url));
if (tabs.length === 0) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
  const created = await res.json();
  tabs = [{ url: created.url, webSocketDebuggerUrl: created.webSocketDebuggerUrl }];
  console.log('탭 신규 오픈:', created.url.slice(0, 70));
  await new Promise((r) => setTimeout(r, 3000));
}

for (const t of tabs) {
  const pws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { pws.onopen = res; pws.onerror = () => rej(new Error('탭 접속 실패')); });
  await new Promise((res) => {
    pws.send(JSON.stringify({ id: 1, method: 'Page.enable', params: {} }));
    pws.send(JSON.stringify({ id: 2, method: 'Page.reload', params: { ignoreCache: true } }));
    setTimeout(res, 4000);
  });
  pws.close();
  console.log('탭 새로고침:', t.url.slice(0, 70));
}
console.log('완료');
