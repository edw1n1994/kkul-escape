/**
 * 키이스케이프 예약 공용 라이브 (의존성 없음, Node 22+)
 *  - rpc(): 사이트가 실제로 쓰는 controller/run_proc.php 호출과 동일한 형태
 *  - cdp(): 127.0.0.1:9222 CDP 에 아주 얇은 클라이언트
 *  - filler()/postNav(): 페이지에 주입할 함수 (Node .toString() 로 넘겨 이스케이프 사고 방지)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RPC_URL = 'https://www.keyescape.com/controller/run_proc.php';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
export const HDR = {
  'User-Agent': UA,
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.keyescape.com/reservation1.php',
};

/** reservation1.php #zizum 옵션 (사이트 정적 markup) */
export const BRANCHES = [
  [26, '에버랜드'], [23, '후즈데어'], [22, 'STATION'], [19, 'LOG_IN 1'], [20, 'LOG_IN 2'],
  [18, '메모리컴퍼니'], [16, '우주라이크'], [14, '더오름'], [3, '강남점'], [10, '홍대점'],
  [9, '부산점'], [7, '전주점'], [25, '무비무드'], [29, '무비무드 전주'],
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rpc(t, params = {}, timeout = 6000) {
  const body = new URLSearchParams();
  body.set('t', t);
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const res = await fetch(RPC_URL, { method: 'POST', headers: HDR, body, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: false, msg: '비JSON 응답: ' + text.slice(0, 120) }; }
}

export const getThemes = (zizumNum) => rpc('get_theme_info_list', { zizum_num: zizumNum });
export const getCalendar = (infoNum) => rpc('get_theme_date', { num: infoNum });
/** 슬롯 목록 -> slots[{num,time,enable,open,sale}] (enable === 'N' 이면 마감/비활성) */
export async function getTimes(zizumNum, themeNum, date) {
  const d = await rpc('get_theme_time', { date, zizumNum, themeNum });
  if (!d.status) return { ok: false, msg: d.msg || '조회 실패', slots: [] };
  return {
    ok: true, msg: d.msg || '',
    slots: (d.data || []).map((i) => ({
      num: i.num, time: `${i.hh}:${i.mm}`, hh: i.hh, mm: i.mm,
      enable: i.enable, open: i.enable !== 'N', sale: i.sale_doc || i.sale_txt || '',
    })),
  };
}

/** CDP 단말 (탭 1개) */
export function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); const events = []; let seq = 0;
  ws.onmessage = (m) => {
    const g = JSON.parse(m.data);
    if (g.id && pending.has(g.id)) { pending.get(g.id)(g); pending.delete(g.id); } else events.push(g);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 접속 실패')); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval 실패');
    return r.result.value;
  };
  const drain = (name) => { const i = events.findIndex((e) => e.method === name); return i > -1 ? events.splice(i, 1)[0] : null; };
  return { ws, ready, send, evaluate, drain, events };
}

export const cdpList = (port) => fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) })
  .then((r) => r.json()).catch(() => null);

/** keyescape 탭을 찾는다. create=true 일 때만 없으면 신규 개설 (폴링용 읽기 호출은 false) */
export async function keTab(port, url = 'https://www.keyescape.com/reservation1.php', create = true) {
  const list = await cdpList(port);
  if (!list) return { ok: false, msg: `CDP(:${port}) 응답 없음 — ../unlock.sh 실행 필요` };
  let tab = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
  if (!tab) {
    if (!create) return { ok: false, msg: 'keyescape 탭 없음 (예약을 실행하면 열립니다)' };
    const n = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      .then((r) => r.json()).catch(() => null);
    if (!n?.webSocketDebuggerUrl) return { ok: false, msg: 'keyescape 탭 개설 실패' };
    await sleep(3000);
    tab = n;
  }
  return { ok: true, tab, tabs: list.filter((t) => t.type === 'page').map((t) => t.url.slice(0, 90)) };
}

/** ── 디버거 차단 무력화 (이 저장소 기존 수재를 그대로 재사용: ../ext/inject.js) ──
 *  키이스케이프 reservation*.php 하단 인라인 스크립트는 devtools-detector 로 디버거를
 *  감지하면 document.body 를 검은 화면으로 갈아치운다. CDP 로 붙는 러너는 사이트 스크립트보다
 *  **먼저** 해제를 등록해야 폼이 남는다. 확장 설치/크롬 재기동까지 하는 본체는 루트의 unlock.mjs.
 *  (캡차 자체에는 손대지 않는다 — 그건 사람의 영역으로 남긴다) */
export const UNLOCK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ext', 'inject.js');

/** 해제 스크립트 원문. 파일이 없으면 null (차단이 없는 사이트/이미지는 건너뛴다) */
export function unlockSource() {
  try { return fs.readFileSync(UNLOCK_FILE, 'utf8'); } catch { return null; }
}

/** 해제 3종 + 몸체 유지 여부 — 루트 unlock.mjs / ui/unlock-status.mjs 와 동일한 지표 */
export const UNLOCK_VERIFY = `(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  (document.body || document.documentElement).dispatchEvent(ev);
  const d = window.devtoolsDetector;
  return JSON.stringify({
    href: location.href.slice(0, 72),
    dummy: !!(d && d.addListener && d.addListener.name === 'noop'),
    ctxOpen: !ev.defaultPrevented,
    keyBlock: typeof document.onkeydown === 'function' ? '차단기 등록됨' : '미등록(F12 열림)',
    wiped: (document.body ? document.body.innerHTML.length : 0) < 400,
  });
})()`;

/** 디버거가 붙은 탭에 해제를 건다. 이후 이동/POST 로 뜨는 새 문서에도 계속 적용된다. */
export async function applyUnlock(c, log = () => {}) {
  const src = unlockSource();
  if (!src) { log(`[UNLOCK] 해제 스크립트 없음(${UNLOCK_FILE}) — 해제 없이 진행합니다`); return { ok: false, why: 'ext/inject.js 없음' }; }
  await c.send('Page.setBypassCSP', { enabled: true }).catch(() => {});
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: src })
    .catch((e) => log('[UNLOCK] 신규 문서 주입 실패: ' + e.message));
  await c.evaluate(src).catch(() => {});                 // 이미 떠 있는 문서에는 지금 바로
  const raw = await c.evaluate(UNLOCK_VERIFY).catch(() => null);
  let s = null;
  try { s = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { s = null; }
  if (!s) return { ok: false, why: '해제 상태 확인 실패 (페이지 이동 중?)' };
  const ok = !!(s.dummy && s.ctxOpen && String(s.keyBlock).startsWith('미등록'));
  log(`[UNLOCK] 디텍터 더미 ${s.dummy ? 'O' : 'X'} / 우클릭 ${s.ctxOpen ? 'O' : 'X'} / F12 ${s.keyBlock}${s.wiped ? ' / 몸체 비어 있음(검은 화면)' : ''}`);
  return { ok, ...s };
}

/** ── 개인 값(예약자명/연락처)은 저장소에 넣지 않는다 ──────────────────────────
 *  해석 순서: ① 커맨드 인자(--name/--hp) ② 환경변수 KEYESCAPE_NAME/KEYESCAPE_HP
 *  ③ ui/local.env (git 에 올리지 않는 로컬 파일) ④ 없음(빈 값)
 *  UI 는 입력값을 브라우저 localStorage(ke.buyer) 에도 저장하므로 보통 두 번째부터는 그것으로 채워진다. */
export const LOCAL_ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'local.env');
let LOCAL_ENV_CACHE = null;

/** ui/local.env 의 KEY=VALUE 를 읽는다 (파일 없으면 빈 객체 — 에러 아니다) */
export function localEnv() {
  if (LOCAL_ENV_CACHE) return LOCAL_ENV_CACHE;
  LOCAL_ENV_CACHE = {};
  try {
    for (const raw of fs.readFileSync(LOCAL_ENV_FILE, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) LOCAL_ENV_CACHE[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 파일 없음 = 기본값 없음 */ }
  return LOCAL_ENV_CACHE;
}

/** 인자 → 환경변수 → local.env 순으로 개인 값을 해석한다 (인자가 true 면 플래그만 된 경우 → 무시) */
export function personal(key, fromArg) {
  const arg = typeof fromArg === 'string' ? fromArg : '';
  return String(arg || process.env[key] || localEnv()[key] || '').trim();
}

/** 로그/화면에 개인 값을 그대로 남기지 않는다 (이름은 첫 글자만, 연락처는 뒤 4자리만) */
export const maskName = (s) => { const v = String(s || '').trim(); return v ? v[0] + '*'.repeat(Math.max(1, v.length - 1)) : '-'; };
export const maskHp = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 4 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : d ? '***' : '-'; };

/** reservation2 열리면 문서 파싱과 동시에 정보/약관을 채우는 주입 코드 */
export function filler(WANT, AGREES) {
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
    for (const k in WANT) {
      const el = document.querySelector('[name=' + k + ']');
      if (!el) { miss = true; continue; }
      if (el.value !== WANT[k]) setV(el, WANT[k]);
    }
    for (const k of AGREES) {
      const el = document.querySelector('[name=' + k + ']');
      if (!el) { miss = true; continue; }
      if (!el.checked) el.click();
    }
    if (!miss) { window.__FILL_MS = performance.now() - t0; window.__FILL_AT = Date.now(); return; }
    if (performance.now() - t0 > 20000) { window.__FILL_ERR = '입력 필드 대기 타임아웃'; return; }
    // 배경 탭(포커스가 다른 창에 있음)에서는 requestAnimationFrame 이 아예 멈춘다(실측: 채움이 중간에 정지).
    // → 화면이 안 보이는 상태에서는 타이머로 다음 시도를 예약한다.
    if (document.hidden) setTimeout(() => tick(), 120); else requestAnimationFrame(tick);
  };
  tick();
}

/** Step1 NEXT 가 만드는 POST 와 동일한 form 을 즉석 생성해 reservation2.php 로 이동 */
export function postNav(P) {
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

/** 사이트의 자동화(디버거) 차단 문구 — 이 문구가 보이면 페이지는 이미 비어 있다 (devtools-detector 2.0.22 실측) */
export const BLOCK_MARK = '개발자 도구 사용이 금지';

/** reservation2 상태를 읽기만 해서 스냅샷 (쓰기 동작 없음) */
export const STEP2_READ = `(() => {
  const q = (n) => document.querySelector('[name=' + n + ']');
  const val = (n) => { const e = q(n); if (!e) return null; return e.type === 'checkbox' ? (e.checked ? '체크' : '미체크') : (e.value || ''); };
  const hid = {};
  ['zizum_num','theme_num','theme_info_num','rev_days','theme_time_num','rev_price','good_name','good_mny'].forEach((n) => {
    const e = q(n); if (e && e.value) hid[n] = e.value;
  });
  const txt = document.body.innerText.replace(/\\s+/g, ' ');
  return {
    onStep2: /reservation2/.test(location.pathname), url: location.href.slice(0, 120),
    blocked: /개발자 도구 사용이 금지/.test(txt),
    fillAt: window.__FILL_AT || null, fillMs: window.__FILL_MS === undefined ? null : window.__FILL_MS,
    fillErr: window.__FILL_ERR || null,
    name: val('name'), person: val('person'),
    mob: ['mobile1','mobile2','mobile3'].map((n) => val(n) || '').join('-'),
    agree: ['agree_1','agree_2','agree_3'].map((n) => n + '=' + (val(n) || '없음')).join(' '),
    captcha: (() => {
      // grecaptcha.getResponse() 는 위젯이 아직 바인딩되지 않으면 예외를 던진다 → 토큰 textarea 를 먼저 읽는다
      const ta = document.querySelector('textarea[name="g-recaptcha-response"]');
      if (ta && ta.value) return ta.value.length;
      try { return (window.grecaptcha && grecaptcha.getResponse().length) || 0; } catch (e) { return 0; }
    })(),
    good: (txt.match(/예약 상품 정보.{0,90}/) || [''])[0],
    pay: val('payment'), mny: val('good_mny') || '', goodName: val('good_name') || '',
    hidden: hid
  };
})()`;

/**
 * reservation2 의 '예약하기' 버튼 클릭 (opt-in: 러너에 --auto-submit 이 있을 때만 호출된다).
 *
 * 2026-09-09 실측 (reservation2.php):
 *   <form id="form" action="/reservation2.php">  … <textarea name="g-recaptcha-response">
 *     └ <button type="submit" class="submit pc">예약하기</button>   ← 이 버튼 하나만 해당
 *   결제는 별개 폼 <form id="order_info" action="…/lib/kcp_pc/pc/pp_cli_hub.php"> 로 넘어간다.
 *   → 즉 이 클릭은 사이트가 준비한 제출 경로 자체를 누르는 것이고, form.submit() 우회가 아니다.
 *
 * reCAPTCHA 는 여기서 건드리지 않는다. 토큰이 '이미 존재' 하는지 읽기만 하고(사람이 클릭했다는 뜻),
 * 없으면 클릭하지 않는다. 토큰을 생성/대입하는 코드는 이 저장소 어디에도 없다.
 *
 * 클릭 전 페이지 안에서 검증하고 하나라도 어긋나면 클릭하지 않는다:
 *   ① reCAPTCHA 토큰 존재 (사람 완료)      ② 숨은 예약좌표 = 목표 (잘못된 회차 결제 방지)
 *   ③ 약관 필수 체크 완료                   ④ 예약자 이름/연락처 입력 완료
 *   ⑤ 상품명/금액이 비어 있지 않음           ⑥ 제출 버튼이 정확히 1개
 *   ⑦ 문서당 1회만 (window.__SUBMITTED) — 중복 예약/중복 결제 방지
 * opt.preview = true 이면 아무것도 누르지 않고 '누를 대상' 만 보고한다.
 */
export function step2Submit(opt) {
  const R = { ok: false, why: '', btn: '', preview: !!opt.preview };
  const f = document.getElementById('form')
    || ((document.querySelector('textarea[name="g-recaptcha-response"]') || {}).form)
    || null;
  if (!f) {
    const t = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 60);
    const bl = /개발자 도구 사용이 금지/.test(t);
    R.blocked = bl;
    R.why = bl ? '사이트가 자동화(디버거)를 차단한 화면입니다 — ' + t : 'reservation2 제출 폼(#form) 을 찾지 못함';
    return R;
  }
  const el = (n) => f.elements[n] || null;
  const val = (n) => { const e = el(n); if (!e) return null; return e.type === 'checkbox' ? e.checked : (e.value || ''); };

  // 제출 버튼 후보
  const seen = new Set();
  const push = (e) => { if (e && !e.disabled && e.getBoundingClientRect().width > 0) seen.add(e); };
  [...f.querySelectorAll('button[type=submit],input[type=submit]')].forEach(push);
  [...f.querySelectorAll('button,a.btn,.btn_submit')].forEach((e) => {
    if (/예약하기|예약완료|예약확정|결제하기/.test((e.innerText || e.value || '').replace(/\s+/g, ''))) push(e);
  });
  const btns = [...seen];
  R.btn = btns.map((b) => `${b.tagName}.${String(b.className).trim()} "${(b.innerText || b.value || '').trim()}"`).join(' | ');
  // 상품명/금액 — 실제 reservation2 에서는 good_name/good_mny 가 KCP 결제용 **별도 폼(order_info)** 에 있다.
  // #form.elements 로만 찾으면 항상 비어서 클릭이 막힌다(실측) → 폼 밖 필드 → 화면 문구 → rev_price 순으로 본다.
  const doc = (n) => { const e = document.querySelector('[name=' + n + ']'); return e ? String(e.value || '') : ''; };
  const txt = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ');
  const shown = (txt.match(/예약 상품 정보\s*(.{2,60}?)\s+\d{4}\.\d{2}\.\d{2}/) || [, ''])[1].trim();
  const amtTxt = (txt.match(/이용금액[^0-9]{0,30}([\d,]{4,})\s*원/) || [, ''])[1].replace(/,/g, '');
  R.good = String(val('good_name') || '') || doc('good_name') || shown;
  R.mny = String(val('good_mny') || '') || doc('good_mny') || amtTxt || String(val('rev_price') || '') || doc('rev_price');
  // 토큰은 '읽기'만 한다. reCAPTCHA 위젯이 아직 바인딩되지 않으면 getResponse() 가 예외를 던지므로 textarea 를 먼저 본다.
  const ta = el('g-recaptcha-response');
  let tokLen = (ta && ta.value) ? String(ta.value).length : 0;
  if (!tokLen) { try { tokLen = String((window.grecaptcha && grecaptcha.getResponse()) || '').length; } catch (e) { tokLen = 0; } }
  R.captcha = tokLen;

  const problems = [];
  if (btns.length !== 1) problems.push('제출 버튼 ' + btns.length + '개(모호)');
  const bad = [];
  for (const k in (opt.want || {})) {
    const got = val(k);
    if (opt.want[k] && got !== null && String(got) !== String(opt.want[k])) bad.push(`${k}=${got}(목표 ${opt.want[k]})`);
  }
  if (bad.length) problems.push('예약좌표 불일치 ' + bad.join(','));
  const miss = (opt.agrees || []).filter((n) => el(n) && el(n).checked !== true);
  if (miss.length) problems.push('약관 미체크 ' + miss.join(','));
  if (!String(val('name') || '').trim()) problems.push('이름 미입력');
  if (!String(val('mobile3') || '').trim()) problems.push('연락처 미입력');
  if (!R.good || !R.mny) problems.push('상품명/금액 없음');
  R.problems = problems;

  if (opt.preview) { R.ok = problems.length === 0; R.why = '프리뷰(클릭 안 함)'; return R; }

  if (!tokLen) { R.why = 'reCAPTCHA 토큰 없음 — 사람이 체크해야 합니다 (대신 클릭하지 않음)'; return R; }
  if (problems.length) { R.why = '검증 실패: ' + problems.join(' / '); return R; }
  if (window.__SUBMITTED) { R.why = '이미 제출됨 (중복 클릭 금지)'; return R; }
  window.__SUBMITTED = Date.now();
  btns[0].click();                       // 사이트 자체 submit 경로 (약관/결제 검증을 그대로 통과)
  R.ok = true; R.why = '예약하기 클릭 완료'; R.at = window.__SUBMITTED;
  return R;
}

/* ===================== 지점별 예약 오픈 시각 =====================
 * 출처: https://www.keyescape.com/reservation.php 의 "[ 지점별 예약 오픈 시간 ]" (2026-09 실측)
 *   더오름점, 우주라이크점, LOG_IN 1, 2 - 10:00     메모리컴퍼니 - 10:30
 *   후즈데어 - 11:00   STATION - 11:30             무비무드 - 13:30
 *   강남점, 부산점, 전주점 - 18:00                  홍대점 - 20:00
 * 며칠 전에 열리는가(오픈 창 D-n) 는 정적 페이지에 없다 → 서버 응답으로 구한다:
 * 오늘부터 n일째까지 get_theme_time 에 슬롯 목록이 뜨고 그 다음 날부터
 * "예약 가능 한 날짜가 아닙니다" 가 나온다. 즉 창 = 오늘 포함 n+1 일, 그 날짜는 D-n 에 열린다.
 */
export const OPEN_TIME_FALLBACK = {
  '더오름': '10:00', '우주라이크': '10:00', 'LOG_IN 1': '10:00', 'LOG_IN 2': '10:00',
  '메모리컴퍼니': '10:30', '후즈데어': '11:00', 'STATION': '11:30',
  '무비무드': '13:30', '무비무드 전주': '13:30',
  '강남점': '18:00', '부산점': '18:00', '전주점': '18:00', '홍대점': '20:00',
};
export const LEAD_DAYS_FALLBACK = 6;   // 실측: 오늘 포함 7일 창 (오늘 +6일까지만 슬롯 목록이 뜬다)

/**
 * 창 크기(D-n) 를 확정하는 곳. 오픈 창 스캔이 그 지점의 오픈 시각 '이전에' 이뤄졌으면
 * 창 끝이 하루 덜 잡혀 있다 (실측: 9/8 10:28 스캔 → 창 끝 9/13(+5), 그러나 실제 창은 +6 → 9/14 는 오늘 10:30 오픈).
 * 그 상태에서 leadDays 를 그대로 쓰면 "9/14 은 9/9 에 열린다" 가 되어 예약이 하루 밀린다.
 */
export function windowSpan({ leadDays, openTime, scanAt, today }) {
  if (leadDays == null) return { span: LEAD_DAYS_FALLBACK, preOpenScan: false, source: `내장 기본 ${LEAD_DAYS_FALLBACK}일` };
  const k = new Date((scanAt || 0) + 9 * 3600 * 1000).toISOString();   // 스캔 순간의 KST 벽시계
  const preOpenScan = !!today && k.slice(0, 10) === today && !!openTime && k.slice(11, 16) < String(openTime).slice(0, 5);
  return {
    span: leadDays + (preOpenScan ? 1 : 0),
    preOpenScan,
    source: `서버 슬롯 스캔 +${leadDays}일${preOpenScan ? ' + 오픈 전 스캔 보정 +1일' : ''}`,
  };
}

const pad2 = (s) => (s.length === 4 ? '0' + s : s);
const branchName = (zizumNum) => (BRANCHES.find(([n]) => n === Number(zizumNum)) || [])[1] || null;

/** reservation.php 본문을 파싱해 { 지점명: 'HH:MM' } 표를 만든다. 실패 시 null */
export function parseOpenTimes(html) {
  const i = String(html).indexOf('지점별 예약 오픈 시간');
  if (i < 0) return null;
  const seg = String(html).slice(i, i + 1500);
  const map = {};
  for (const li of seg.match(/<li>[\s\S]*?<\/li>/g) || []) {
    const txt = li.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const m = txt.match(/^(.+?)\s*-\s*(\d{1,2}:\d{2})\s*$/);
    if (!m) continue;
    // "LOG_IN 1, 2" 처럼 번호 꼬리 생략 → "LOG_IN 1, LOG_IN 2" 로 펼친 뒤known 이름과 대조
    const names = m[1]
      .replace(/([A-Za-z가-힣][A-Za-z가-힣_. 0-9]*)\s(\d+)\s*,\s*(\d+)/g, '$1 $2, $1 $3')
      .split(',').map((s) => s.trim()).filter(Boolean);
    for (const [, name] of BRANCHES) {
      const base = name.replace(/점$/, '');
      // 사이트는 본점만 적는다 → '무비무드' 한 줄이 '무비무드 전주' 도 커버한다고 본다
      if (names.some((n) => n === name || n === base || n.startsWith(name) || n.startsWith(base) || name.startsWith(n))) map[name] = m[2];
    }
  }
  return Object.keys(map).length ? map : null;
}

let OPEN_CACHE = { at: 0, map: null, source: '' };
/** 오픈 시각 표: 사이트에서 가져와 30분 캐시, 실패하면 내장 표 */
export async function openTimeMap(force) {
  if (!force && OPEN_CACHE.map && Date.now() - OPEN_CACHE.at < 1800000) return OPEN_CACHE;
  try {
    const html = await fetch('https://www.keyescape.com/reservation.php', { headers: { ...HDR }, signal: AbortSignal.timeout(9000) }).then((r) => r.text());
    const map = parseOpenTimes(html);
    // 사이트 표가 이기되, 사이트가 본점만 적어 빠진 지점(예: LOG_IN 2, 무비무드 전주) 은 내장 표로 메꾼다
    if (map) OPEN_CACHE = { at: Date.now(), map: { ...OPEN_TIME_FALLBACK, ...map }, source: 'reservation.php' };
  } catch { /* 오프라인/차단 → 폴백 */ }
  if (!OPEN_CACHE.map) OPEN_CACHE = { at: Date.now(), map: OPEN_TIME_FALLBACK, source: '내장 표(폴백)' };
  return OPEN_CACHE;
}

const WINDOW_CACHE = new Map();   // '지점:테마:정보' → { at, leadDays, windowEnd, today, apiTime }
const wkey = (zizum, theme, info) => `${zizum}:${theme}:${info || ''}`;
/**
 * /api/matrix 가 이미 훑은 날짜표를 받아 오픈 창을 기억한다 (재스캔 불필요).
 * 마지막 날짜에도 슬롯 목록이 뜨면 창이 더 크다는 뜻 → 애매하므로 기억하지 않는다.
 */
export function noteWindow(zizum, theme, info, today, rows) {
  if (!Array.isArray(rows) || rows.length < 8 || !today) return null;
  if (rows[rows.length - 1].total > 0) return null;
  let last = -1;
  rows.forEach((r, i) => { if (r.total > 0) last = i; });
  if (last < 0) return null;
  const hit = WINDOW_CACHE.get(wkey(zizum, theme, info));
  const out = {
    at: Date.now(), leadDays: last > 0 ? last : null, windowEnd: rows[last].date, today,
    apiTime: (hit && hit.apiTime) || null,
    lastMsg: (rows.find((r) => !r.total && r.msg) || {}).msg || '',
  };
  const m = out.lastMsg.match(/예약\s*오픈\s*시간\s*:?\s*(\d{1,2}:\d{2})/);
  if (m) out.apiTime = pad2(m[1]);
  if (out.leadDays != null) WINDOW_CACHE.set(wkey(zizum, theme, info), out);
  return out;
}
/** 서버가 실제로 슬롯 목록을 내주는 마지막 날짜를 스캔해 오픈 창(D-n) 을 구한다 */
export async function reserveWindow(zizum, theme, info, ttl = 600000) {
  const key = wkey(zizum, theme, info);
  const hit = WINDOW_CACHE.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit;
  const cal = info ? await rpc('get_theme_date', { num: Number(info) }).catch(() => null) : null;
  const today = cal?.calendarData?.today || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const start = Date.parse(today + 'T00:00:00Z');
  let leadDays = -1, windowEnd = null, apiTime = null, lastMsg = '';
  for (let i = 0; i < 21; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const r = await getTimes(Number(zizum), Number(theme), d);
    if (r.slots.length) { leadDays = i; windowEnd = d; }
    else {
      lastMsg = r.msg || '';
      const t = String(r.msg || '').match(/예약\s*오픈\s*시간\s*:?\s*(\d{1,2}:\d{2})/);
      if (t) apiTime = pad2(t[1]);
      break;
    }
    await sleep(110);
  }
  const out = { at: Date.now(), leadDays: leadDays > 0 ? leadDays : null, windowEnd, today, apiTime, lastMsg };
  WINDOW_CACHE.set(key, out);
  return out;
}

/**
 * "이 날짜는 언제 열리나" — 지점 오픈 시각 + 오픈 창(D-n) → KST ISO.
 *   openInfo({ zizum, theme, info, date })
 *    → { ok, openAt, openTime, leadDays, today, windowEnd, past, ... }
 */
export async function openInfo({ zizum, theme, info, date }) {
  const branch = branchName(zizum);
  const [{ map, source }, win] = await Promise.all([openTimeMap(), reserveWindow(zizum, theme, info)]);
  const tableTime = branch ? map[branch] : null;
  const apiTime = win.apiTime && win.apiTime !== tableTime ? win.apiTime : null;
  const openTime = pad2(apiTime || tableTime || '');
  const span = windowSpan({ leadDays: win.leadDays, openTime, scanAt: win.at, today: win.today });
  const leadDays = span.span;
  const base = {
    branch, openTime: openTime.slice(0, 5) || null,
    openTimeSource: apiTime ? '사이트 응답 메시지' : source,
    leadDays, leadSource: span.source, preOpenScan: span.preOpenScan,
    today: win.today, windowEnd: win.windowEnd, date: date || null,
  };
  if (!openTime || !date) return { ok: false, ...base, note: !openTime ? `지점 '${branch || zizum}' 의 오픈 시각을 찾지 못함` : '날짜 미선택' };
  const t = Date.parse(date + 'T00:00:00Z') - leadDays * 86400000;
  const openDate = new Date(t).toISOString().slice(0, 10);
  const openAt = `${openDate}T${openTime}:00+09:00`;
  return {
    ok: true, ...base, openDate, openAt,
    msUntil: Date.parse(openAt) - Date.now(), past: Date.parse(openAt) < Date.now(), note: win.lastMsg || '',
  };
}

