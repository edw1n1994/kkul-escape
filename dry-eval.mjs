#!/usr/bin/env node
/** reserve-open.mjs 의 페이지 주입 표현식이 문법/실행 오류 없이 도는지 현재 탭에서 미리 확인 (값은 무의미) */
const PORT = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab) { console.error('탭 없음'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let seq = 0; const p = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && p.has(g.id)) { p.get(g.id)(g); p.delete(g.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const HP = (process.env.KEYESCAPE_HP || '').replace(/[^0-9]/g, '');   // 010xxxxxxxx (저장소에 개인 값을 두지 않음)
const BUYER = { name: process.env.KEYESCAPE_NAME || '', mobile1: HP.slice(0, 3) || '010', mobile2: HP.slice(3, 7) || '0000', mobile3: HP.slice(7) || '0000' };
const AGREES = ['agree_1', 'agree_2'];

const fillExpr = `(() => {
  const WANT = ${JSON.stringify(BUYER)}, AGREES = ${JSON.stringify(AGREES)};
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const out = {};
  for (const [k, v] of Object.entries(WANT)) { const el = document.querySelector('[name=' + k + ']'); if (el) { set(el, v); out[k] = el.value; } else out[k] = '필드 없음'; }
  for (const k of AGREES) { const el = document.querySelector('[name=' + k + ']'); if (el && !el.checked) el.click(); out[k] = el ? (el.checked ? '체크' : '실패') : '없음'; }
  return out;
})()`;

const capExpr = `(() => ({ resp: (document.querySelector('[name=g-recaptcha-response]')||{value:''}).value.length,
  anchor: [...document.querySelectorAll('iframe')].some(f=>/recaptcha\\/api2\\/anchor/.test(f.src||'')),
  info: (document.body.innerText.match(/예약 상품 정보.{0,80}/)||[''])[0] }))()`;

const watchExpr = `(() => ({ r: (window.grecaptcha && grecaptcha.getResponse().length) || 0,
    left: location.href.includes('reservation2') }))()`;

console.log('현재 탭 :', await ev('location.href'));
console.log('fillExpr  :', JSON.stringify(await ev(fillExpr)));
console.log('capExpr   :', JSON.stringify(await ev(capExpr)));
console.log('watchExpr :', JSON.stringify(await ev(watchExpr)));
console.log('✅ 세 표현식 모두 실행 오류 없음');
ws.close();
