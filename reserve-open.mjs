#!/usr/bin/env node
/**
 * 10:30 오픈 즉시 FILM BY EDDY 2026-09-10 19:50 을 잡아 Step2 까지 0딜레이로 준비한다.
 *
 *   node reserve-open.mjs
 *   OPEN_AT='2026-09-04T10:30:00+09:00' WANT='19:50' node reserve-open.mjs
 *
 * 마지막 2클릭(reCAPTCHA 체크, '예약하기') 은 이 스크립트가 수행하지 않는다.
 *   - reCAPTCHA 는 사용자 제스처용 관문이고
 *   - '예약하기'(.submit) 클릭이 실제 예약 등록 POST + 결제 레이어를 여는 동작이기 때문이다.
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const Z = process.env.ZIZUM || '18', T = process.env.THEME || '57';
const INFO = process.env.INFO || '34', D = process.env.DATE || '2026-09-10';
const WANT = process.env.WANT || '19:50';
const OPEN_AT = process.env.OPEN_AT || '2026-09-04T10:30:00+09:00';
const PREROLL_MS = Number(process.env.PREROLL_MS || 2500);   // 오픈 2.5초 전부터 슬롯 응답 대기
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 180000);
const HP = (process.env.KEYESCAPE_HP || '').replace(/[^0-9]/g, '');   // 010xxxxxxxx (저장소에 개인 값을 두지 않음)
const BUYER = { name: process.env.KEYESCAPE_NAME || '', mobile1: HP.slice(0, 3) || '010', mobile2: HP.slice(3, 7) || '0000', mobile3: HP.slice(7) || '0000' };
const AGREES = ['agree_1', 'agree_2'];
const URL1 = `https://www.keyescape.com/reservation1.php?zizum_num=${Z}&theme_num=${T}&theme_info_num=${INFO}`;

const t0process = Date.now();
const log = (...a) => {
  const l = `[${new Date().toISOString().slice(11, 23)}] ${a.join(' ')}`;
  console.log(l); fs.appendFileSync(HERE + 'reserve.log', l + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function times() {
  const res = await fetch('https://www.keyescape.com/controller/run_proc.php', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': URL1,
    },
    body: new URLSearchParams({ t: 'get_theme_time', date: D, zizumNum: Z, themeNum: T }),
  });
  return res.json();
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); const events = [];
  let seq = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 접속 실패')); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = async (m, ms = 15000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const i = events.findIndex((e) => e.method === m);
      if (i > -1) return events.splice(i, 1)[0];
      await sleep(60);
    }
    return null;
  };
  const goto = async (url) => { events.length = 0; await send('Page.navigate', { url }); await waitEvent('Page.loadEventFired'); };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, ready, send, evaluate, goto, waitEvent };
}

/* ---------- 브라우저 사전 준비 (오픈 전에해둔다) ---------- */
let list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let tab = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab) {
  const c0 = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL1)}`, { method: 'PUT' })).json();
  tab = { webSocketDebuggerUrl: c0.webSocketDebuggerUrl };
  await sleep(3000);
}
const c = client(tab.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');
log('브라우저 연결 + reservation1 선로드');
await c.goto(URL1);
/* ---------- 오픈 대기 -> 슬롯 확보 ---------- */
const at = new Date(OPEN_AT).getTime();
const startAt = at - PREROLL_MS;
if (Date.now() < startAt) { log(`대기 ${(startAt - Date.now()) / 1000}초 (오픈 ${OPEN_AT})`); await sleep(startAt - Date.now()); }

let slot = null;
const dl = Date.now() + DEADLINE_MS;
for (let n = 1; !slot && Date.now() < dl; n++) {
  const now = Date.now();
  const d = await times().catch((e) => ({ status: false, msg: String(e.message) }));
  const hit = (d.data || []).find((i) => `${i.hh}:${i.mm}` === WANT);
  if (d.status && hit && hit.enable !== 'N') {
    slot = hit;
    log(`슬롯 확보 (시도 ${n}) themeTimeNum=${hit.num} ${WANT} 가능 — elapsed ${now - at}ms`);
  } else {
    if (n % 10 === 1) log('시도 ' + n + ': ' + (d.status ? (hit ? (WANT + ' enable=' + hit.enable) : (WANT + ' 없음')) : '(응답 실패)') + ' / ' + (d.msg || ''));
    await sleep(now < at ? 700 : 300);
  }
}
if (!slot) { log(`${WANT} 을 ${DEADLINE_MS / 1000}초 안에 확보하지 못해 중단`); c.ws.close(); process.exit(2); }

/* ---------- Step1 -> Step2 0딜레이 진행 ---------- */
const OPTS = { zizum: Z, theme: T, date: D, time: String(slot.num), submit: true };
await c.goto(URL1);
const rep = await c.evaluate(`(async () => { const OPTS=${JSON.stringify(OPTS)};\n${PAGE_SRC}\n})()`);
rep.log.forEach((l) => log('Step1 | ' + l));

let ok = false;
for (let i = 1; i <= 12 && !ok; i++) {
  const href = String(await c.evaluate('location.href').catch(() => ''));
  if (href.includes('reservation2')) { ok = true; break; }
  log(`Step2 대기 ${i}차 (${href}) -> NEXT 재클릭`);
  await c.evaluate(`document.querySelector('.btn_next_step')?.click();'ok'`).catch(() => {});
  await sleep(1200);
}
if (!ok) { log('Step2 도달 실패'); c.ws.close(); process.exit(2); }
await c.waitEvent('Page.loadEventFired', 12000);

/* ---------- Step2 입력 (이름/연락처/필수약관) ---------- */
const filled = await c.evaluate(`(() => {
  const WANT = ${JSON.stringify(BUYER)}, AGREES = ${JSON.stringify(AGREES)};
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const out = {};
  for (const [k, v] of Object.entries(WANT)) { const el = document.querySelector('[name=' + k + ']'); if (el) { set(el, v); out[k] = el.value; } else out[k] = '필드 없음'; }
  for (const k of AGREES) { const el = document.querySelector('[name=' + k + ']'); if (el && !el.checked) el.click(); out[k] = el ? (el.checked ? '체크' : '실패') : '없음'; }
  return out;
})()`);
log('Step2 입력 완료: ' + JSON.stringify(filled));

const cap = await c.evaluate(`(() => ({ resp: (document.querySelector('[name=g-recaptcha-response]')||{value:''}).value.length,
  anchor: [...document.querySelectorAll('iframe')].some(f=>/recaptcha\\/api2\\/anchor/.test(f.src||'')),
  info: (document.body.innerText.match(/예약 상품 정보.{0,80}/)||[''])[0] }))()`);
log('예약 좌표: ' + cap.info);
log(`reCAPTCHA 위젯 anchor=${cap.anchor} 응답=${cap.resp}`);
log('--------------------------------------------------');
log('이제 브라우저에서 직접: 1) "로봇이 아닙니다" 체크  2) "예약하기" 클릭');
log('이 스크립트는 위 두 클릭을 대신 하지 않습니다. (토큰 유효 ~2분, 즉시 진행)');
log('--------------------------------------------------');

/* ---------- 클릭 감지만 계속 수행 ---------- */
const watchUntil = Date.now() + 5 * 60000;
let done = false;
while (Date.now() < watchUntil && !done) {
  const s = await c.evaluate(`(() => ({ r: (window.grecaptcha && grecaptcha.getResponse().length) || 0,
    left: location.href.includes('reservation2') }))()`).catch(() => null);
  if (!s) break;
  if (s.r > 0) { log(`✅ reCAPTCHA 완료 감지(응답 ${s.r}자) — 이제 "예약하기"만 클릭하세요`); done = true; }
  else if (!s.left) { log('페이지가 이동했습니다 — 예약 진행 여부를 브라우저에서 확인하세요'); done = true; }
  else await sleep(1000);
}
if (!done) log('5분 내 클릭 감지 없음. 준비된 상태는 유지되어 있습니다.');
c.ws.close();

