#!/usr/bin/env node
/**
 * 머니머니패키지 (지점 19 LOG_IN 1 / themeNum 60 / themeInfoNum 38)
 *   2026-09-10 14:40 -> Step1 자동 진행 -> Step2(reservation2.php) 입력폼에
 *   이름/연락처(환경변수 KEYESCAPE_NAME · KEYESCAPE_HP) 를 대입한 뒤 정지.  **결제/제출은 하지 않는다.**
 *
 * 9/10 은 해당 지점 예약오픈시각(10:00) 이전에는 서버가 거절하므로,
 * OPEN_AT 시각까지 기다렸다가 실행한다.
 *
 *   OPEN_AT='2026-09-04T10:00:20+09:00' node flow.mjs
 *   node flow.mjs            # 즉시 실행 (이미 오픈된 뒤)
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const ZIZUM = process.env.ZIZUM || '19';
const THEME = process.env.THEME || '60';
const INFO = process.env.INFO || '38';
const DATE = process.env.DATE || '2026-09-10';
const WANT = process.env.WANT || '14:40';
const HP = (process.env.KEYESCAPE_HP || '').replace(/[^0-9]/g, '');   // 010xxxxxxxx (저장소에 개인 값을 두지 않음)
const BUYER = { name: process.env.KEYESCAPE_NAME || '', mobile1: HP.slice(0, 3) || '010', mobile2: HP.slice(3, 7) || '0000', mobile3: HP.slice(7) || '0000' };
const URL1 = `https://www.keyescape.com/reservation1.php?zizum_num=${ZIZUM}&theme_num=${THEME}&theme_info_num=${INFO}`;

function log(...a) {
  const line = `[${new Date().toLocaleTimeString('ko-KR')}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(HERE + 'flow.log', line + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let seq = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else events.push(msg);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 접속 실패')); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = async (method, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = events.findIndex((e) => e.method === method);
      if (i > -1) return events.splice(i, 1)[0];
      await sleep(80);
    }
    return null;
  };
  const goto = async (url, ms = 20000) => {
    events.length = 0;
    const r = await send('Page.navigate', { url });
    if (r && r.errorText) throw new Error('navigate 실패: ' + r.errorText);
    await waitEvent('Page.loadEventFired', ms);
    await sleep(1200);
    return r;
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, ready, send, evaluate, goto, waitEvent, events };
}

/** 오픈 시각 대기 */
const OPEN_AT = process.env.OPEN_AT;
if (OPEN_AT) {
  const at = new Date(OPEN_AT).getTime();
  const now = Date.now();
  if (at > now) {
    log(`오픈 시각 대기: ${OPEN_AT} (=${Math.round((at - now) / 1000)}초 후)`);
    await sleep(at - now + 1000);
  }
}

/* ---------- 1) 14:40 슬롯 번호 조회 ---------- */
async function getTime() {
  const res = await fetch('https://www.keyescape.com/controller/run_proc.php', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': URL1,
    },
    body: new URLSearchParams({ t: 'get_theme_time', date: DATE, zizumNum: ZIZUM, themeNum: THEME }),
  });
  return res.json();
}

let timeNum = null;
for (let tryn = 1; tryn <= 20; tryn++) {
  const d = await getTime();
  if (!d.status) { log(`슬롯 조회 ${tryn}차 실패: ${d.msg}`); await sleep(20000); continue; }
  const hit = (d.data || []).find((i) => `${i.hh}:${i.mm}` === WANT);
  if (!hit) { log('14:40 슬롯 자체가 없음: ' + (d.data || []).map((i) => i.hh + ':' + i.mm).join(',')); process.exit(2); }
  if (hit.enable === 'N') { log(`14:40(value=${hit.num}) 은 마감 상태 (${tryn}차)`); await sleep(20000); continue; }
  timeNum = hit.num;
  log(`목표 슬롯 확보: 14:40 = themeTimeNum ${timeNum} (선택가능)`);
  break;
}
if (!timeNum) { log('14:40 을 확보하지 못해 중단'); process.exit(2); }

/* ---------- 2) Step1 자동 진행 (지점/테마/날짜/시간 -> NEXT) ---------- */
const list1 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let tab1 = list1.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab1) {
  log('keyescape 탭이 없어 새로 엽니다');
  const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL1)}`, { method: 'PUT' })).json();
  tab1 = { webSocketDebuggerUrl: created.webSocketDebuggerUrl };
  await sleep(3000);
}
const c = client(tab1.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');

log('reservation1 로드: ' + URL1);
await c.goto(URL1);
for (let i = 1; i <= 6; i++) {
  const href = await c.evaluate('location.href');
  if (href.includes('zizum_num=' + ZIZUM)) { log('reservation1 준비 완료: ' + href); break; }
  log(`href 대기 ${i}차: ${href} -> 재내비게이션`);
  await c.goto(URL1);
}

const PAGE_SRC = fs.readFileSync(HERE + 'step1-page.js', 'utf8');
const OPTS = { zizum: ZIZUM, theme: THEME, date: DATE, time: String(timeNum), submit: true };
const rep = await c.evaluate(`(async () => { const OPTS=${JSON.stringify(OPTS)};\n${PAGE_SRC}\n})()`);
rep.log.forEach((l) => log('Step1 | ' + l));
log('Step1 요약: ' + rep.reservInfo);

/* ---------- 3) Step2 입력폼 채우기 (제출 안 함) ---------- */
let onStep2 = false;
for (let i = 1; i <= 8 && !onStep2; i++) {
  await sleep(2500);
  const href = await c.evaluate('location.href').catch(() => '(평가가 대기 중)');
  if (String(href).includes('reservation2')) { onStep2 = true; break; }
  log(`Step2 대기 ${i}차, 현재 ${href} -> NEXT 재클릭`);
  await c.evaluate(`document.querySelector('.btn_next_step')?.click(); 'ok'`).catch(() => {});
}
if (!onStep2) { log('reservation2 에 도달하지 못해 중단'); process.exit(2); }
await c.waitEvent('Page.loadEventFired', 15000);
await sleep(1500);
log('Step2 도착: ' + (await c.evaluate('location.href')));

const FILL = `(() => {
  const WANT = ${JSON.stringify(BUYER)};
  const setVal = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, v);                                   // React 식 setter 우회까지 감안한 정석 대입
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const result = {};
  for (const [k, v] of Object.entries(WANT)) {
    const el = document.querySelector('[name="' + k + '"]') || document.querySelector('#' + k);
    if (!el) { result[k] = '필드 없음'; continue; }
    const isSel = el.tagName === 'SELECT';
    if (isSel && ![...el.options].some((o) => o.value === v)) { result[k] = '옵션 없음: ' + [...el.options].map((o) => o.value).join('/'); continue; }
    setVal(el, v);
    result[k] = (isSel ? 'select->' : 'input->') + el.value;
  }
  return {
    filled: result,
    snapshot: [...document.querySelectorAll('input, select, textarea')].map((e) => ({
      name: e.name || e.id, tag: e.tagName, type: e.type || '', value: (e.value || '').slice(0, 30),
      checked: !!e.checked, hidden: e.type === 'hidden',
    })),
    header: (document.querySelector('.reservationPick, .resrvStep, h2, h3')?.innerText || '').trim().slice(0, 120),
    text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 420),
  };
})()`;

const s2 = await c.evaluate(FILL);
log('채운 값: ' + JSON.stringify(s2.filled));
log('화면 요약: ' + s2.text.slice(0, 200));
fs.writeFileSync(HERE + 'step2-snapshot.json', JSON.stringify(s2, null, 2));

const shot = await c.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(HERE + 'step2.png', Buffer.from(shot.data, 'base64'));
log('step2.png / step2-snapshot.json 저장 완료');

const after = await c.evaluate(`[...document.querySelectorAll('[name=name],[name=mobile1],[name=mobile2],[name=mobile3],[name=person]')].map(e=>e.name+'='+e.value).join(' | ')`);
log('최종 확인: ' + after);
log('*** 결제(제출) 버튼은 누르지 않고 정지했습니다. ***');
c.ws.close();

