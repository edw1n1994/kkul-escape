#!/usr/bin/env node
/**
 * 10:30 오픈 즉시 FILM BY EDDY 2026-09-10 19:50 을 확보, Step2 도달 + 폼 입력까지 최단 시각에 수행.
 *
 * 기존 reserve-open.mjs 와 다른 점 (실측 근거):
 *   1) Step1 UI 경유를 삭제. NEXT 가 만드는 POST 와 동일한 form 을 직접 만들어 reservation2.php 로 POST 이동
 *      -> get_theme_info_list / get_theme_date / get_theme_time 왕복 3회 + 렌더 대기 제거 (약 3~5초 -> 0초)
 *   2) 입력을 CDP 왕복으로 하지 않고 addScriptToEvaluateOnNewDocument 로 페이지 시작 시 주입
 *      -> 문서 파싱과 동시에 채워짐 (CDP 라운드트립 1회분 제거)
 *   3) 커넥션 워밍 (콜드 156ms -> 워밍 28ms)
 *
 * reCAPTCHA 체크와 '예약하기' 클릭은 계속 사용자 동작으로 남긴다.
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const Z = process.env.ZIZUM || '18', T = process.env.THEME || '57';
const INFO = process.env.INFO || '34', D = process.env.DATE || '2026-09-10';
const WANT = process.env.WANT || '19:50', TNAME = process.env.TNAME || 'FILM BY EDDY';
const OPEN_AT = process.env.OPEN_AT || '2026-09-04T10:30:00+09:00';
const PREROLL_MS = 20000, POLL_OPEN_MS = 45, POLL_PRE_MS = 400, DEADLINE_MS = Number(process.env.DEADLINE_MS || 120000);
const HP = (process.env.KEYESCAPE_HP || '').replace(/[^0-9]/g, '');   // 010xxxxxxxx (저장소에 개인 값을 두지 않음)
const BUYER = { name: process.env.KEYESCAPE_NAME || '', mobile1: HP.slice(0, 3) || '010', mobile2: HP.slice(3, 7) || '0000', mobile3: HP.slice(7) || '0000' };
const AGREES = ['agree_1', 'agree_2'];
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.keyescape.com/reservation1.php',
};
const RPC = 'https://www.keyescape.com/controller/run_proc.php';

const log = (...a) => {
  const l = `[${new Date().toISOString().slice(11, 23)}] ${a.join(' ')}`;
  console.log(l); fs.appendFileSync(HERE + 'reserve-fast.log', l + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (params) => fetch(RPC, { method: 'POST', headers: HDR, body: new URLSearchParams(params), signal: AbortSignal.timeout(2000) }).then((r) => r.json());

/* ---------- 페이지에 주입될 코드 (Node 함수 .toString() 로 이스케이프 사고 방지) ---------- */
function filler(WANTF, AGREESF) {
  if (!/reservation2/.test(location.pathname)) return;
  const t0 = performance.now();
  const setV = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tick = () => {
    let miss = false;
    for (const k in WANTF) {
      const el = document.querySelector('[name=' + k + ']');
      if (!el) { miss = true; continue; }
      if (el.value !== WANTF[k]) setV(el, WANTF[k]);
    }
    for (const k of AGREESF) {
      const el = document.querySelector('[name=' + k + ']');
      if (!el) { miss = true; continue; }
      if (!el.checked) el.click();
    }
    if (!miss) { window.__FILL_MS = performance.now() - t0; window.__FILL_AT = Date.now(); return; }
    if (performance.now() - t0 > 15000) { window.__FILL_ERR = '타임아웃'; return; }
    requestAnimationFrame(tick);
  };
  tick();
}

function postNav(P) {
  const f = document.createElement('form');
  f.method = 'post'; f.action = '/reservation2.php'; f.enctype = 'multipart/form-data';
  for (const k in P) {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = P[k]; f.appendChild(i);
  }
  document.documentElement.appendChild(f);
  f.submit();
  return Date.now();
}

/* ---------- CDP 클라이언트 ---------- */
function client(u) {
  const ws = new WebSocket(u); const pending = new Map(); const events = []; let seq = 0;
  ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pending.has(g.id)) { pending.get(g.id)(g); pending.delete(g.id); } else events.push(g); };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = async (m, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { const i = events.findIndex((e) => e.method === m); if (i > -1) return events.splice(i, 1)[0]; await sleep(30); }
    return null;
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, ready, send, evaluate, waitEvent };
}

/* ---------- 준비 ---------- */
const list0 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let tab = list0.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab) {
  const n = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('https://www.keyescape.com/reservation1.php')}`, { method: 'PUT' })).json();
  tab = { webSocketDebuggerUrl: n.webSocketDebuggerUrl }; await sleep(3000);
}
const c = client(tab.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');
// 입력기를 문서 시작 시 주입 (reservation2 가 열리면 파싱과 동시에 채워진다)
await c.send('Page.addScriptToEvaluateOnNewDocument', {
  source: '(' + filler.toString() + ')(' + JSON.stringify(BUYER) + ',' + JSON.stringify(AGREES) + ')',
});
await c.evaluate(`(() => { const f=document.querySelector('#zizum'); if(f && f.value!=='${Z}'){ f.value='${Z}'; f.dispatchEvent(new Event('change',{bubbles:true})); } return location.href.slice(0,60); })()`);
/* ---------- 오픈 전 워밍 폴링 -> 슬롯 히트 ---------- */
const at = new Date(OPEN_AT).getTime();
// 긴 setTimeout 은 이 환경에서 재개되지 않은 사례가 있어 1초 단위로 쪼개서 대기한다
while (Date.now() < at - PREROLL_MS) {
  const left = (at - PREROLL_MS - Date.now()) / 1000;
  if (Math.floor(left) % 60 === 0 && !globalThis.__lastBeat || globalThis.__lastBeat !== Math.floor(left / 60)) {
    globalThis.__lastBeat = Math.floor(left / 60);
    log(`대기 중 ${left.toFixed(0)}초`);
  }
  await sleep(1000);
}

let slot = null, tHit = 0, n = 0;
const dl = Math.max(at, Date.now()) + DEADLINE_MS;
while (!slot && Date.now() < dl) {
  n++;
  const t = Date.now();
  const d = await rpc({ t: 'get_theme_time', date: D, zizumNum: Z, themeNum: T }).catch((e) => ({ status: false, msg: String(e.message).slice(0, 40) }));
  const hit = (d.data || []).find((i) => `${i.hh}:${i.mm}` === WANT);
  if (d.status && hit && hit.enable !== 'N') { slot = hit; tHit = Date.now(); log(`히트 ${WANT} themeTimeNum=${slot.num} (시도 ${n}, 요청 ${Date.now() - t}ms)`); }
  else {
    if (n <= 3 || n % 60 === 0) log(`시도 ${n}: ${d.status ? (hit ? WANT + ' enable=' + hit.enable : WANT + ' 미노출') : '응답실패 ' + (d.msg || '')} / 남은시간 ${((dl - Date.now()) / 1000).toFixed(0)}초`);
    await sleep(Date.now() < at ? POLL_PRE_MS : POLL_OPEN_MS);
  }
}
if (!slot) { log('슬롯 확보 실패로 종료'); c.ws.close(); process.exit(2); }

/* ---------- Step1 생략 POST_direct -> reservation2 ---------- */
const payload = { zizumNum: Z, themeNum: T, themeInfoNum: INFO, revDays: D, themeTimeNum: String(slot.num), revTimes: WANT, themeName: TNAME };
const tPost = Date.now();
const tPagePost = await c.evaluate('(' + postNav.toString() + ')(' + JSON.stringify(payload) + ')');
log(`POST 제출 (히트 후 ${tPost - tHit}ms) / 페이지 submit ${tPagePost - tHit}ms`);

// loadEvent(KCP/캡차 리소스 포함) 를 기다리지 않고, 입력 완료 순간을 20ms 폴링으로 포착
let tLoaded = 0;
const tp0 = Date.now();
while (Date.now() - tp0 < 9000) {
  const v = await c.evaluate('window.__FILL_AT || null').catch(() => null);
  if (v) { tLoaded = v; break; }
  await sleep(20);
}
if (!tLoaded) { await c.waitEvent('Page.loadEventFired', 5000); tLoaded = Date.now(); }
const st = await c.evaluate(`(() => ({ url: location.href, fillMs: window.__FILL_MS ?? null, fillAt: window.__FILL_AT ?? null, err: window.__FILL_ERR ?? null,
  name: (document.querySelector('[name=name]')||{}).value || '', mob: ['mobile1','mobile2','mobile3'].map(n => (document.querySelector('[name='+n+']')||{}).value||'').join('-'),
  ag: ['agree_1','agree_2','agree_3'].map(n => { const e=document.querySelector('[name='+n+']'); return n+'='+(e? (e.checked?'체크':'미체크'):'없음'); }).join(' '),
  good: (document.body.innerText.match(/예약 상품 정보.{0,60}/)||[''])[0],
  cap: (window.grecaptcha && grecaptcha.getResponse().length) || 0 }))()`).catch((e) => ({ err: String(e.message) }));

log('----------------------------------------------');
log('URL                : ' + st.url);
log(`★ 슬롯 발견 → 폼 입력완료 : ${(st.fillAt || tLoaded) - tHit}ms`);
log(`  내역             : 히트→POST ${tPost - tHit}ms / POST→입력완료 ${tLoaded - tPost}ms / 문서내 입력 ${st.fillMs}ms`);
log('예약 좌표          : ' + st.good);
log('입력 확인          : ' + st.name + ' / ' + st.mob + ' / ' + st.ag);
log('reCAPTCHA          : ' + (st.cap > 0 ? `이미 완료(${st.cap}자)` : '미완료 — 직접 체크 필요'));
log('----------------------------------------------');
log('남은 동작(사용자): 1) "로봇이 아닙니다" 체크  2) "예약하기" 클릭');
log('이 두 클릭은 수행하지 않습니다. 캡차 토큰은 약 2분 유효.');

/* ---------- 클릭 감시 ---------- */
const until = Date.now() + 5 * 60000;
let done = false;
while (Date.now() < until && !done) {
  const s = await c.evaluate(`(() => ({ r: (window.grecaptcha && grecaptcha.getResponse().length) || 0, onStep2: location.href.includes('reservation2') }))()`).catch(() => null);
  if (!s) break;
  if (s.r > 0) { log('✅ reCAPTCHA 완료 감지 — 이제 "예약하기"만 클릭하세요'); done = true; }
  else if (!s.onStep2) { log('페이지 이동 감지 — 브라우저에서 결과를 확인하세요'); done = true; }
  else await sleep(700);
}
if (!done) log('5분 내 클릭 감지 없음. 준비 상태는 유지됩니다.');
c.ws.close();

