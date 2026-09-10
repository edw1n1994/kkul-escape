#!/usr/bin/env node
/**
 * 테스트용 유틸: CDP 로 빈 탭을 열고 keyescape 로 이동한 뒤 targetId 를 stdout 에 출력한다.
 *
 * 왜 필요한가: 헤드리스 Chromium(리눅스) 은 GET/PUT /json/new?url=... 의 url 파라미터를
 * 무시하고 about:blank 만 연다. 실제 런너는 "탭을 만들고 → 주입하고 → Page.navigate" 순으로
 * 움직이므로, 테스트도 같은 경로(Page.navigate)로 탭을 준비해야 실사용과 같은 상태를 검증한다.
 *
 *   node scripts/docker/docker-opentab.mjs [URL]        CDP_PORT 로 포트 지정 (기본 9222)
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const URL2 = process.argv.find((a) => /^https?:/.test(a)) || 'https://www.keyescape.com/reservation1.php';
const HOST = `http://127.0.0.1:${PORT}`;

const ver = await fetch(`${HOST}/json/version`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
if (!ver) { console.error('CDP 없음'); process.exit(3); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 실패')); });
let seq = 0; const pend = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); } };
const send = (method, params = {}, sid) => new Promise((res, rej) => {
  const id = ++seq;
  const t = setTimeout(() => { pend.delete(id); rej(new Error(method + ' 시간 초과')); }, 9000);
  pend.set(id, (x) => { clearTimeout(t); x.error ? rej(new Error(`${method}: ${JSON.stringify(x.error)}`)) : res(x.result); });
  ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
const list = async () => (await fetch(`${HOST}/json/list`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => []));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId).catch(() => {});
await send('Page.navigate', { url: URL2 }, sessionId).catch(() => {});

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 700));
  const t = (await list()).find((x) => x.id === targetId);
  if (t && /keyescape\.com/i.test(t.url || '')) { console.log(targetId); ws.close(); process.exit(0); }
}
console.log(targetId);            // id 는 어쨌든-print (정리용)
console.error('이동 실패');
ws.close();
process.exit(1);
