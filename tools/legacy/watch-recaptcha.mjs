#!/usr/bin/env node
/**
 * reCAPTCHA 를 마우스로 클릭했는지 감시 (읽기 전용).
 *   node watch-recaptcha.mjs [초]      기본 300초
 * 응답(g-recaptcha-response)이 채이면 그 순간 출력하고 끝난다.
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const SECS = Number(process.argv[2] || 300);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page' && /reservation2/.test(t.url));
if (!tab) { console.error('reservation2 탭 없음'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');

const probe = async () => {
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const api = (window.grecaptcha && grecaptcha.getResponse && grecaptcha.getResponse().length) || 0;
      const ta = (document.querySelector('[name=g-recaptcha-response]') || {}).value || '';
      const anchor = [...document.querySelectorAll('iframe')].some((f) => /recaptcha\\/api2\\/anchor/.test(f.src || ''));
      const badge = [...document.querySelectorAll('iframe')].some((f) => /recaptcha\\/api2\\/bframe/.test(f.src || ''));
      const box = document.querySelector('.g-recaptcha');
      const cb = box ? box.getBoundingClientRect() : null;
      return { api, ta: ta.length, anchor, badge,
               pos: cb ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height), inView: cb.y > 0 && cb.y < innerHeight } : null,
               agree: ['agree_all','agree_1','agree_2','agree_3'].map((k) => k + '=' + (((document.querySelector('#' + k) || document.querySelector('[name=' + k + ']')) || {}).checked === true)).join(' ') };
    })()`,
  });
  return r.result.value;
};

console.log(`감시 시작 (${SECS}초). 브라우저에서 '로봇이 아닙니다' 체크박스를 마우스로 클릭하세요.`);
const t0 = Date.now();
let last = '';
while ((Date.now() - t0) / 1000 < SECS) {
  let s;
  try { s = await probe(); } catch (e) { console.log('평가 실패(이동 중?):', e.message); }
  if (s) {
    const line = `${((Date.now() - t0) / 1000).toFixed(0)}초 | 응답 api=${s.api} textarea=${s.ta} | 위젯 anchor=${s.anchor} bframe=${s.badge} | 위치 ${JSON.stringify(s.pos)} | ${s.agree}`;
    if (line !== last) { console.log(line); last = line; }
    if (s.api > 0 || s.ta > 0) { console.log('\n✅ reCAPTCHA 완료 — 응답 토큰 확보 (' + (s.api || s.ta) + '자). 토큰 유효시간은 약 2분이라 바로 진행하세요.'); ws.close(); process.exit(0); }
  }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('\n미완료로 종료 — 위젯이 안 보이면 스크롤이 필요하고, ' + "'자동화된 쿼리로 의심됩니다'가 뜨면 평소 크롬에서 다시 시도하세요.");
ws.close();
