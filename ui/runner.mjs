#!/usr/bin/env node
/**
 * 키이스케이프 예약 실행 엔진 (UI/CLI 겸용)
 *
 *   node runner.mjs --zizum 18 --theme 57 --info 34 --date 2026-09-10 \
 *        --times "19:50,20:20" --tname "FILM BY EDDY" \
 *        [--open-at 2026-09-04T10:30:00+09:00] [--deadline 60] [--port 9222] \
 *        [--name 홍길동 --hp 010-0000-0000] [--agrees agree_1,agree_2] [--dry]
 *        [--auto-submit]  (키이스케이프) 캡차 통과 감지 후 '예약하기' 1회 클릭 (기본 off / reCAPTCHA 는 사람이 클릭)
 *        [--submit-preview]  제출 대상만 보고하고 아무것도 클릭하지 않음
 *
 *   --site dps  로 단편선(dpsnnn.com/reserve_g, 아임웹) 예약을 같은 흐름으로 쓴다.
 *     단편선에는 캡차가 없고 예약좌표(prod_idx/start_day) 를 화면에서 검증할 수 있어 '예약하기' 자동 클릭이 **기본 on**
 *     (끄려면 --no-auto-submit → 사람이 클릭하고 결제화면 채움만 자동).
 *     클릭 후 결제화면(/shop_payment/) 에서 이름/연락처/입금자명 + 무통장입금 선택 + **약관 전체동의**를 자동 처리한다
 *     (약관 자동 체크를 끄려면 --no-agree-all).
 *        [--pay-submit]  최종 '결제하기' 를 게이트 통과 시 1회 클릭 — 돈이 나가는 동작이므로 **항상 opt-in, 기본 off** (UI 체크박스)
 *        [--pay-total 56000]  결제하기 전에 결제예상금액까지 비교 (기본: 금액이 읽히고 0원이 아니면 통과)
 *        [--dep 입금자명]  결제화면의 입금자명 (미지정 시 예약자명과 동일)
 *
 *   --site zeroworld  로 같은 예약을 제로월드(zeroworldkorea.com) 에도 쓴다.
 *     제로월드는 테마번호가 info 를 겸하고 예약 페이지가 한 장이라 reservation2 흐름이 없다.
 *     → 히트 시 같은 페이지에서 날짜/테마/시간을 확정하고 이미지 캡차만 사용자에게 남긴다.
 *
 * 동작: ① --open-at 까지 1초 단위 대기 → 오픈 전 PREROLL 초부터 슬롯 폴링(기본 45ms)
 *       ② --times 는 우선순위. 노출 + enable!=N 인 첫 항목을 확보
 *       ③ Step1 UI 를 생략하고 reservation2.php 로 직접 POST (NEXT 와 동일 폼)
 *       ④ reservation2 열리면 주입된 입력기가 name/mobile/약관을 즉시 채움
 *          (인원은 사이트 기본값을 쓴다 -- 인자 없을 때 폼에 손을 대지 않는다)
 *       ⑤ reCAPTCHA '로봇이 아닙니다' 체크는 반드시 사람이 한다 (대신 클릭/풀이 하지 않는다)
 *       ⑥ --auto-submit 을 주면 사람이 캡차를 통과한 직후 '예약하기' 를 1회 클릭한다
 *          (좌표/약관/예약자/금액 검증 후, 토큰 없으면 클릭하지 않는다. 결제 화면으로 넘어간다)
 *
 * 오픈 시각 오토필: UI 는 lib.mjs 의 openInfo() 로 "그 날짜가 열리는 시각"
 *   (지점별 오픈 시각은 reservation.php, 며칠 전 오픈인지는 서버 슬롯 스캔) 을 계산해 넣어준다.
 *
 * stdout 은 UI 가 파싱하기 쉬운 "키=값" / 평문 로그 라인. 진행상황은 접두어 [RUN]/[HIT]/[STEP2] 등.
 */
import fs from 'node:fs';
import { runNaver } from './naver.mjs';
import { zwArmHumanInput, zwSubmit } from './zw-submit.mjs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { rpc, getTimes, cdp, keTab, filler, postNav, sleep, STEP2_READ, step2Submit, BLOCK_MARK, BRANCHES, applyUnlock, personal, maskName, maskHp } from './lib.mjs';
import { siteOf, apiTimes, siteTab, zwFiller, zwPick, ZW_READ } from './sites.mjs';
import { dpsUrl, dpsFiller, dpsBook, dpsPay, dpsSlotRead, dpsOrderRead, dpsLogin } from './sites.mjs';

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) { const k = process.argv[i].slice(2); A[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
}
if (A.site === 'naver') {
  try { await runNaver(A); } catch (e) { console.error('[FAIL] ' + e.message); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}
const PORT = Number(A.port || 9222);
const SITE = siteOf(A.site);   // keyescape(기본) | zeroworld
const Z = String(A.zizum || ''), T = String(A.theme || ''), INFO = String(A.info || A.theme || '');
const D = String(A.date || ''), TNAME = String(A.tname || '');
const TIMES = String(A.times || '').split(',').map((s) => s.trim()).filter(Boolean);
// 오픈 시각 예약이 기본 사용법이다. --open-at 이 없으면 "지금 발사" 가 되므로 경고하고 지나간다.
const OPEN_AT = A['open-at'] ? new Date(String(A['open-at'])).getTime() : Date.now();
if (!A['open-at'] && !A.dry) console.log('[WARN] --open-at 없음 → 즉시 발사합니다 (UI 는 항상 openInfo 로 계산한 오픈 시각을 넘깁니다)');
const DEADLINE_S = Number(A.deadline || 60);
const PREROLL = Number(A.preroll || 20000);
const POLL_OPEN = Number(A['poll-open'] || 45);
// 예약자 이름/연락처는 저장소에 없다 (인자 → 환경변수 → ui/local.env 순으로 해석)
const BUYER = { name: personal('KEYESCAPE_NAME', A.name) };
const hp = personal('KEYESCAPE_HP', A.hp).replace(/[^0-9]/g, '');
const HPD = hp.length >= 10 ? `${hp.slice(0, 3)}-${hp.slice(3, 7)}-${hp.slice(7)}` : '010-0000-0000';
if (SITE.key === 'dps') {                       // 단편선: 결제화면에서 이름 / 연락처 1줄 / 입금자명을 채운다
  BUYER.hp = HPD;
  let dp = personal('KEYESCAPE_DEP', A.dep);    // 입금자명도 개인 값 — 저장소에 없다 (인자→env→ui/local.env)
  if (!dp && BUYER.name) {
    dp = BUYER.name;   // 사이트 기본값이 '미입력시 주문자명' 이고 공지도 입금자명=예약자명 이라 동일하게 둔다 (조용히 하지 않고 알린다)
    console.log('[WARN] 입금자명(--dep / KEYESCAPE_DEP) 미지정 → 예약자명과 동일하게 채웁니다 (사이트 공지: 입금자명이 다르면 예약이 취소될 수 있음)');
  }
  if (dp) BUYER.dep = dp;
} else if (SITE.buyerMode === 'mobile1line') BUYER.mobile = HPD;      // 제로월드: 연락처 한 줄(13자 검증)
else { BUYER.mobile1 = HPD.slice(0, 3); BUYER.mobile2 = HPD.slice(4, 8); BUYER.mobile3 = HPD.slice(9); }
const AGREES = String(A.agrees || SITE.agrees.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const PERSON = A.person ? String(A.person) : null;
if (PERSON) BUYER.person = PERSON;
const DRY = !!A.dry;
// 👀 감시 전용: 디버거(CDP) 를 아예 붙이지 않는다. 사이트는 devtools-detector 로 디버거가 붙은
// 페이지를 통째로 막아버리므로, 페이지를 건드리지 않는 이 방식만이 차단과 무관하게 항상 동작한다.
// → 슬롯 조회(서버 JSON) 만 반복하고, 목표 시각이 열리는 순간 알림 + 예약 페이지를 열어 사람에게 넘긴다.
const WATCH_ONLY = !!A['watch-only'];
const NO_OPEN = !!A['no-open'];
const WATCH_POLL = Math.max(Number(A['poll-open'] || 300), 120);   // 감시 전용은 서버에 예의 있게 300ms
// 키이스케이프: reCAPTCHA 는 어떤 경우에도 대신 누르지 않고, '예약하기' 는 --auto-submit opt-in (기본 off).
// 단편선: 캡차가 없고 예약좌표(prod_idx/start_day) 를 화면에서 검증할 수 있으므로 '예약하기' 자동 클릭이 **기본 on**
//   (--no-auto-submit 로 끄면 사람이 클릭하고 결제화면 채움만 자동이 된다). 약관 전체동의 자동 체크도 기본 on (--no-agree-all).
// 최종 '결제하기' 는 돈이 나가는 동작이라 **항상 기본 off** — UI 체크박스(= --pay-submit) 로만 켜진다.
const PAY_SUBMIT = !!A['pay-submit'] && SITE.key === 'dps' && !WATCH_ONLY;
const AGREE_ALL = SITE.key === 'dps' && !A['no-agree-all'] && !WATCH_ONLY;
const AUTO_SUBMIT = !WATCH_ONLY && (SITE.key === 'dps'
  ? (PAY_SUBMIT || !A['no-auto-submit'])            // 결제까지 자동으론 예약하기 자동이 전제다
  : !!A['auto-submit'] && ['keyescape', 'zeroworld'].includes(SITE.key));
const SUBMIT_PREVIEW = !!A['submit-preview'];
// 단편선은 '예약하기' 클릭(자동 또는 사람) 이후에 결제화면이 서버에서 렌더된다. 그 클릭/렌더를 기다리는 창(초).
const HUMAN_WAIT = Math.max(30, Number(A['human-wait'] || (AUTO_SUBMIT ? (PAY_SUBMIT ? 90 : 60) : 240)));

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(7);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)} +${el()}s] ${a.join(' ')}`);
const out = (tag, o) => console.log(`${tag} ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ')}`);

if (!Z || !T || (SITE.needsInfo && !INFO) || !D || (!DRY && !TIMES.length)) {
  console.log(`[FAIL] 필요 인자 부족: ${SITE.needsInfo ? '--zizum --theme --info --date' : '--zizum --theme --date'} --times (--dry 는 --times 생략 가능)`);
  process.exit(64);
}
log(`목표 [${SITE.label}] 지점${Z} 테마${T}${SITE.needsInfo ? `(info ${INFO})` : ''} ${D} 우선순위 ${TIMES.join(' > ')} 오픈 ${new Date(OPEN_AT).toISOString()} 마감 ${DEADLINE_S}s`);

/* ---------- 1) 브라우저 준비 + 입력기 사전 주입 (감시 전용이면 연결하지 않는다) ---------- */
let c = null;
const run = (cmd, args) => new Promise((res) => execFile(cmd, args, (err, so, se) => res(
  err ? { ok: false, why: String((se && se.trim()) || err.message).slice(0, 110) } : { ok: true, why: String(so || '').trim().slice(0, 60) || 'ok' })));
/** macOS 시스템 알림(소리 포함). 실패해도 흐름을 막지 않는다 */
async function notify(title, body) {
  if (process.platform !== 'darwin') return;
  const r = await run('osascript', ['-e', `display notification "${body}" with title "${title}" sound name "Glass"`]);
  log(`[ALERT] 시스템 알림: ${r.ok ? '발송 성공' : '실패 — ' + r.why}`);
}
/** 사람에게 넘긴다: 클릭 순서 안내 + 시스템 알림(소리) + 기본 브라우저에 예약 페이지 열기. 클릭/입력은 대신 하지 않는다. */
async function handoff(why, urlOverride) {
  const url = urlOverride || SITE.step1(Z);
  const br = (SITE.branches.find((b) => String(b[0]) === String(Z)) || [Z, `지점${Z}`])[1];
  const seq = [br, TNAME || `테마${T}`, D, TIMES.join('/')].filter(Boolean).join(' → ');
  log(`[HANDOFF] 클릭 순서(사람): ${seq} → 자동등록방지 → 예약하기   ( ${why} )`);
  log(`[HANDOFF] 링크: ${url}`);
  if (process.platform !== 'darwin') { log('[HANDOFF] macOS 가 아니라 알림/창 열기는 건너뜁니다 — 위 로그가 안내입니다'); return; }
  if (!NO_OPEN) {
    const r = await run('open', [url]);
    log(`[HANDOFF] 브라우저 열기: ${r.ok ? '요청 성공 (OS 기본 브라우저)' : '실패 — ' + r.why}`);
  }
  const n = await run('osascript', ['-e', `display notification "${seq}" with title "🎯 ${SITE.label} 슬롯 열림" sound name "Glass"`]);
  log(`[HANDOFF] 시스템 알림: ${n.ok ? '발송 성공 (소리 포함)' : '실패 — ' + n.why}`);
}
if (!DRY && !WATCH_ONLY) {
  const t = SITE.key === 'keyescape' ? await keTab(PORT) : await siteTab(PORT, SITE.key, Z);
  if (!t.ok) { log('[FAIL] ' + t.msg); process.exit(3); }
  c = cdp(t.tab.webSocketDebuggerUrl);
  try { await c.ready; } catch (e) { log('[FAIL] CDP 세션 실패: ' + e.message); process.exit(3); }
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  // Runtime.enable 만으로도 사이트의 devtools-detector 가 발동해 body 를 지운다.
  // 따라서 입력기를 넣기 **전에** 이 저장소의 기존 해제(ext/inject.js) 를 먼저 등록한다
  // (addScriptToEvaluateOnNewDocument 는 등록 순서대로 실행되므로 해제가 사이트 스크립트보다 앞선다).
  if (SITE.key === 'keyescape') await applyUnlock(c, log);
  const inject = SITE.key === 'dps'
    ? `(${dpsFiller.toString()})(${JSON.stringify(BUYER)},${JSON.stringify({ agreeAll: AGREE_ALL })})`   // 결제화면에서 이름/연락처/입금자명 + 무통장입금 + 약관 전체동의
    : SITE.key === 'zeroworld'
      ? `(${zwFiller.toString()})(${JSON.stringify(BUYER)})`
      : `(${filler.toString()})(${JSON.stringify(BUYER)},${JSON.stringify(AGREES)})`;
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
  if (SITE.key === 'zeroworld' && AUTO_SUBMIT) {
    const arm = `(${zwArmHumanInput.toString()})()`;
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: arm });
    await c.evaluate(arm);
  }
  // 제로월드는 페이지를 이동하지 않으므로 지금 이 문서에도 바로 한 번 돌린다 (이름/연락처/인원 사전 입력)
  if (SITE.key === 'zeroworld') await c.evaluate(inject).catch((e) => log('[WARN] 사전 입력기 실행 실패: ' + e.message));
  log(`[READY] ${SITE.label} CDP 탭 연결 / 입력기 주입 (${maskName(BUYER.name)} ${maskHp(HPD)} 약관 ${AGREES.length}개)`);
  if (!BUYER.name || hp.length < 10) log('[WARN] 예약자 이름/연락처가 비어 있습니다 — --name/--hp 또는 ui/local.env(KEYESCAPE_NAME/KEYESCAPE_HP) 또는 화면 입력으로 채우세요. 빈 값은 폼에 입력되지 않고 자동 제출도 거부됩니다');
} else if (WATCH_ONLY) {
  log('[READY] 감시 전용 — 디버거를 붙이지 않습니다 (서버 슬롯 조회만 하고, 열리는 순간 사람에게 넘깁니다)');
}
// 자동화 범위(무엇을 대신하고 무엇을 사람이 하는지) 를 시작 전에 공표한다 — 로그만 봐도 알 수 있게
if (SITE.key === 'dps' && !WATCH_ONLY) {
  log(`[POLICY] 약관 전체동의 ${AGREE_ALL ? '자동 체크' : '사람 체크'} · '예약하기' ${AUTO_SUBMIT ? '자동 클릭(단편선 기본값)' : '사람 클릭'} · 최종 '결제하기' ${PAY_SUBMIT ? '★ 자동 클릭 — 실제로 결제가 진행됩니다' : '사람 클릭 (UI 체크박스를 켠 경우에만 자동)'}`);
  if (PAY_SUBMIT) log('[POLICY] 결제하기 게이트: 결제화면 + 무통장입금 선택 + 이름/연락처/입금자명 채워짐 + 약관 전체 체크 + 금액 0원 아님 + 버튼 정확히 1개 + 중복 클릭 금지 — 하나라도 걸리면 누르지 않습니다 (금액까지 검증하려면 --pay-total)');
}

/* ---------- 2) 슬롯 폴링 (오픈 전 워밍 -> 우선순위 히트) ---------- */
// 단편선은 이야기(상품 idx)마다 같은 시각이 있을 수 있어 시간대 + 상품 idx 로 찾는다.
const slotFor = (slots, want) => SITE.key === 'dps'
  ? slots.find((x) => x.time === want && String(x.num) === String(T))
  : slots.find((x) => x.time === want);
if (DRY) {
  const r = await apiTimes(SITE.key, Z, T, D);
  const nowK = new Date(Date.now() + 9 * 3600 * 1000).toISOString();   // KST 벽시계
  const stName = (s) => (s.open ? '선택가능'
    : (D < nowK.slice(0, 10) || (D === nowK.slice(0, 10) && (s.time + ':00') < nowK.slice(11, 19))) ? '지난시각'
      : (SITE.key === 'zeroworld' ? '마감(선택불가)' : '미오픈(오픈 대기)'));
  out('[SLOTS]', { ok: r.ok, msg: r.msg || '-', count: r.slots.length });
  for (const s of r.slots) out('  ', { time: s.time, num: s.num, state: stName(s), sale: s.sale || '-' });
  if (TIMES.length) log('[DRY] 우선순위 ' + TIMES.map((w) => { const s = slotFor(r.slots, w); return `${w}=${s ? stName(s) : '목록없음'}`; }).join(' / '));
  if (!r.slots.length) log(`[DRY] 슬롯 목록이 아직 없습니다 — 예약 창이 열리면 생깁니다 (msg: ${r.msg || '-'})`);
  if (c) c.ws.close();
  process.exit(0);
}

// 긴 setTimeout 은 이 환경에서 재개되지 않은 사례가 있어 1초 단위로 쪼갠다
while (Date.now() < OPEN_AT - PREROLL) {
  const left = (OPEN_AT - PREROLL - Date.now()) / 1000;
  if (globalThis.__beat !== Math.floor(left / 60)) { globalThis.__beat = Math.floor(left / 60); log(`[WAIT] ${left.toFixed(0)}초 남음`); }
  await sleep(1000);
}

const dl = Math.max(OPEN_AT, Date.now()) + DEADLINE_S * 1000;
let hit = null, all = [], n = 0, lastMsg = '';
while (!hit && Date.now() < dl) {
  n++;
  const r = await apiTimes(SITE.key, Z, T, D).catch((e) => ({ ok: false, msg: String(e.message).slice(0, 60), slots: [] }));
  if (r.ok) {
    all = r.slots;
    for (const want of TIMES) {
      const s = slotFor(r.slots, want);
      if (s && s.open) { hit = s; break; }
    }
    if (!hit) {
      const line = `노출 ${r.slots.length}개 / 가능 ${r.slots.filter((s) => s.open).length}개 / ` +
        TIMES.map((w) => { const s = slotFor(r.slots, w); return `${w}${s ? (s.open ? ':O' : ':N') : ':x'}`; }).join(' ');
      if (line !== lastMsg) { lastMsg = line; log(`[POLL] ${n}회 ${line} / 남은 ${((dl - Date.now()) / 1000).toFixed(0)}s`); }
    }
  } else if (r.msg !== lastMsg) { lastMsg = r.msg; log(`[POLL] ${n}회 응답: ${r.msg} (아직 예약 창 밖일 수 있음)`); }
  if (!hit) await sleep(Date.now() < OPEN_AT ? 400 : (WATCH_ONLY ? WATCH_POLL : POLL_OPEN));
}
if (!hit) {
  out('[MISS]', { tries: n, target: TIMES.join(','), open_now: all.filter((s) => s.open).map((s) => s.time).join(',') || '없음' });
  if (c) c.ws.close();
  process.exit(2);
}
const tHit = Date.now();
out('[HIT]', { time: hit.time, themeTimeNum: hit.num, tries: n, open_slots: all.filter((s) => s.open).length });

/* ---------- 2-W) 감시 전용은 여기서 끝. 디버거를 붙이지 않으니 사이트 차단과 무관하게 동작한다 ---------- */
if (WATCH_ONLY) {
  out('[WATCH]', { 시간: hit.time, themeTimeNum: hit.num, tries: n, 처리: '사람이 브라우저에서 직접 선택/캡차/결제' });
  await handoff(`${hit.time} 열림 / 회차번호 ${hit.num}`, SITE.key === 'dps' ? (hit.url || dpsUrl(hit.num, D.replace(/-/g, ''))) : undefined);
  process.exit(0);
}

/* ---------- 3-DPS) 단편선: 슬롯 페이지로 이동 → '예약하기' 자동 클릭(기본) → 결제화면 자동 채움 + 약관 전체동의 ----------
 *  최종 '결제하기' 는 UI 체크박스(--pay-submit) 로 켰을 때만, 게이트를 통과하면 1회 누른다. */
if (SITE.key === 'dps') {
  const url = hit.url || dpsUrl(hit.num, D.replace(/-/g, ''));
  log(`[DPS] 슬롯 페이지로 이동: ${url}`);
  await c.send('Page.navigate', { url }).catch((e) => log('[FAIL] 이동 실패: ' + e.message));
  let sl = null;
  for (let i = 0; i < 40; i++) {
    sl = await c.evaluate(`(${dpsSlotRead.toString()})()`).catch(() => null);
    // 달력 JS 가 hidden(start_day) 을 채우는 데 시간이 조금 걸린다 → 좌표가 다 채워질 때까지 기다린다
    if (sl && sl.bookingForm && sl.hidden && sl.hidden.prod_idx && sl.hidden.start_day) break;
    await sleep(250);
  }
  out('[SLOT]', {
    url: (sl && sl.href) || '-', 상품명: (sl && sl.title) || '-', 금액: (sl && sl.price) || '-',
    prod_idx: (sl && sl.hidden && sl.hidden.prod_idx) || '-', start_day: (sl && sl.hidden && sl.hidden.start_day) || '-',
    예약하기: ((sl && sl.buttons) || 0) + '개', 로그인: sl && !sl.guest ? '됨' : '아니오', after_hit_ms: Date.now() - tHit,
  });
  const lg = await dpsLogin(PORT).catch(() => null);
  if (lg) log(`[LOGIN] ${lg.msg}${lg.source ? ' (' + lg.source + ')' : ''}`);
  if (!lg || lg.loggedIn === false) {
    log('[ABORT] 단편선은 로그인해야 예약할 수 있습니다 — 브라우저에서 로그인한 뒤 다시 실행하세요 (아무것도 클릭하지 않았습니다)');
    await shot('need-login');
    await handoff('로그인 필요', url);
    c.ws.close(); process.exit(8);
  }
  const want = { idx: String(hit.num), day: D };
  const book = (preview) => c.evaluate(`(${dpsBook.toString()})(${JSON.stringify({ want, preview })})`)
    .catch((e) => ({ ok: false, problems: ['evaluate 실패: ' + e.message] }));
  if (SUBMIT_PREVIEW) {
    const p = await book(true);
    out('[PREVIEW]', {
      클릭대상: p.btn || '-', 대상: `${p.prod || '-'} / ${p.day || '-'}`, 금액: p.price || '-',
      결제수단: p.payHint || '결제화면에서 무통장입금 선택 예정',
      폼검증: (p.problems || []).length ? '실패' : '통과', 문제: (p.problems || []).join(',') || '없음',
    });
    log(`[PREVIEW] ${(p.problems || []).length ? '검증 미통과 — 클릭 대상이 아닙니다' : '지금 상태 그대로면 클릭 가능한 폼입니다'} (아무것도 클릭하지 않았습니다)`);
    c.ws.close(); process.exit(0);
  }
  if (!AUTO_SUBMIT) {
    log(`[TODO] 브라우저에서 '예약하기' 를 클릭하세요 — 클릭 후 결제화면의 이름/연락처/입금자명과 무통장입금은 자동으로 채워집니다 (최대 ${HUMAN_WAIT}초 대기)`);
    notify(`${SITE.label} 예약 대기`, `${D} ${hit.time} — 브라우저에서 '예약하기' 를 클릭하면 결제화면을 채웁니다`);
  } else {
    const p = await book(true);
    out('[CHECK]', {
      버튼: p.btn || '-', 대상: `${p.prod || '-'} / ${p.day || '-'}`, 금액: p.price || '-',
      폼검증: (p.problems || []).length ? '실패' : '통과', 문제: (p.problems || []).join(',') || '없음',
    });
    const r = await book(false);
    out('[SUBMIT]', { ok: r.ok, 버튼: r.btn || '-', 사유: (r.problems || []).join(',') || '-', after_hit_ms: Date.now() - tHit });
    if (!r.ok) { log('[ABORT] 예약하기 를 누르지 않았습니다 — 브라우저에서 직접 클릭하세요 (재시도 없음)'); c.ws.close(); process.exit(9); }
  }
  /** 최종 '결제하기' — 게이트(dpsPay) 를 모두 통과했을 때만 1회 클릭하고 결과를 확인한다. 실패 시 재시도 없다. */
  const payOpt = (preview) => ({ preview, wantTotal: String(A['pay-total'] || '').replace(/[^0-9]/g, '') });
  const pay = (preview) => c.evaluate(`(${dpsPay.toString()})(${JSON.stringify(payOpt(preview))})`)
    .catch((e) => ({ ok: false, problems: ['evaluate 실패: ' + e.message], boxes: 0, unchecked: [] }));
  async function payNow() {
    const pc = await pay(true);
    out('[PAYCHECK]', {
      버튼: pc.btn || '-', 금액: pc.total || '-', 결제수단: pc.pay || '-',
      약관: `${pc.boxes || 0}개 / 미체크 ${(pc.unchecked || []).join(',') || '없음'}`,
      게이트: (pc.problems || []).length ? '걸림' : '통과', 문제: (pc.problems || []).join(' / ') || '없음',
    });
    const pr = await pay(false);
    out('[PAY]', { ok: pr.ok, 버튼: pr.btn || '-', 금액: pc.total || '-', 사유: (pr.problems || []).join(' / ') || '-', ms_after_hit: Date.now() - tHit });
    if (!pr.ok) {
      log("[ABORT] '결제하기' 를 누르지 않았습니다 — 게이트 미통과. 브라우저에서 직접 클릭하세요 (재시도 없음)");
      await shot('pay-refused');
      await notify(`${SITE.label} 자동 결제 거부됨`, (pr.problems || []).join(', ').slice(0, 90));
      return;
    }
    log("[PAY] '결제하기' 를 정확히 1회 클릭했습니다 — 화면이 옮겨가는지 확인합니다");
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
      await sleep(500);
      const dlg = c.drain('Page.javascriptDialogOpening');
      if (dlg) {
        log('[ALERT] 사이트 메시지: ' + String((dlg.params && dlg.params.message) || '').replace(/\s+/g, ' ').slice(0, 160));
        await c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
      const st = await c.evaluate(`(${dpsOrderRead.toString()})()`).catch(() => null);
      if (st && st.href && !/order_code/i.test(st.href)) moved = true;   // 주문 코드가 사라지면 다음 화면으로 진행된 것
    }
    out('[RESULT]', { 상태: moved ? '결제화면을 떠남 — 주문/입금 안내 화면으로 진행' : '클릭 후 20초간 결제화면에 남음 — 브라우저에서 결과 확인하세요' });
    await shot('pay-clicked');
    await notify(`${SITE.label} 결제하기 클릭 완료`, `${D} ${hit.time} — 결제/입금 처리 여부를 화면에서 확인하세요`);
  }

  // 결제화면은 예약하기 클릭(사람 또는 자동) 이후에야 서버가 렌더한다. 사람 클릭을 기다리는 동안
  // 필드 후보를 계속 밖에 내보낸다 — 아임웹은 name/id 가 사이트 설정마다 달라 이 실측이 확정 근거가 된다.
  let od = null, fieldsDumped = false, beat = 0;
  const dUntil = Date.now() + HUMAN_WAIT * 1000;
  while (Date.now() < dUntil) {
    const dlg = c.drain('Page.javascriptDialogOpening');
    if (dlg) {
      log('[ALERT] 사이트 메시지: ' + String((dlg.params && dlg.params.message) || '').replace(/\s+/g, ' ').slice(0, 120));
      await c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
    od = await c.evaluate(`(${dpsOrderRead.toString()})()`).catch(() => null);
    // URL 만 결제화면이고 입력란은 그 뒤 클라이언트 렌더된다(실측: 첫 스냅샷 inputs=0) → 필드가 나타난 뒤에만 확정한다
    if (od && od.onPayment && (od.inputs || []).length >= 2) break;
    if (!fieldsDumped && od && (od.inputs || []).length >= 3) {   // 아직 결제화면이 아니어도 보이는 필드를 먼저 기록해 둔다
      out('[FIELDS]', { where: (od.href || '-').slice(0, 70), inputs: od.inputs.map((i) => `${i.key}[${i.type}](${i.label})`).slice(0, 20) });
      fieldsDumped = true;
    }
    if (!AUTO_SUBMIT && ++beat % 40 === 0) log(`[WAIT] '예약하기' 클릭 대기 중… 남은 ${Math.round((dUntil - Date.now()) / 1000)}초`);
    await sleep(300);
  }
  // 결제화면이 열려도 주입된 입력기가 채움을 끝내기 전에는 결과를 발표하지 않는다 (실측 레이스)
  for (let i = 0; od && od.onPayment && !od.fillAt && !od.fillErr && i < 100; i++) {
    await sleep(250);
    od = await c.evaluate(`(${dpsOrderRead.toString()})()`).catch(() => od);
  }
  if (!od || !od.onPayment) {
    out('[ORDER]', { 상태: `결제화면 미도착 (${HUMAN_WAIT}초)`, url: (od && od.href) || '-', 처리: AUTO_SUBMIT ? '브라우저 확인 필요' : '사람 클릭 대기' });
    log('[WARN] 결제화면(/shop_payment/) 을 확인하지 못했습니다 — 브라우저에서 상태를 확인하세요 (재시도/재클릭 없음)');
  } else {
    out('[ORDER]', {
      url: od.href, 금액: od.total || '-', 결제수단: od.pay || '-',
      입금계좌: /^auto/.test(od.bank || '') ? '자동 선택 (계좌 1개)' : od.bank === 'already' ? '사이트 선택값 유지'
        : od.bank === 'multi' ? '선택지 여러 개 — 사람이 선택' : od.bank === 'none' ? '계좌 없음' : '-',
      채운값: Object.entries(od.filled || {}).map(([k, v]) => `${k}=${/^hp/.test(k) ? maskHp(v) : maskName(v)}`).join(' ') || '-',
      입력기간: (od.matched && Object.values(od.matched).join(' | ')) || '-',
      누락: (od.missing || []).join(',') || '없음', fill_ms: od.fillMs ?? '-',
    });
    // 필드 확정 근거: 화면의 모든 입력란을 키/라벨과 함께 남긴다 (개인값은 값이 아니라 기간만)
    out('[FIELDS]', {
      where: od.href.slice(0, 70),
      inputs: (od.inputs || []).map((i) => `${i.key}[${i.type}](${i.label})`),
      radios: (od.radios || []).map((r) => `${r.key}(${r.label})${r.checked ? '*선택' : ''}`),
      buttons: od.buttons || [],
    });
    if (od.fillErr) log('[WARN] 입력기: ' + od.fillErr);
    out('[AGREE]', {
      약관: `${(od.checks || []).length}개`, 체크됨: `${(od.checks || []).filter((x) => x.checked).length}개`,
      미체크: (od.checks || []).filter((x) => !x.checked).map((x) => x.key).join(',') || '없음',
      자동체크: AGREE_ALL ? 'on' : 'off',
    });
    await shot('order-ready');
    if (PAY_SUBMIT) await payNow();
    else log("[HANDOFF] 이름/연락처/입금자명 · 무통장입금 · 약관 전체동의까지 끝났습니다 — 마지막 '결제하기' 는 사람이 클릭합니다 (UI 에서 '결제하기까지 자동 클릭' 을 켜면 게이트 통과 시 자동)");
  }
  c.ws.close();
  process.exit(0);
}

/* ---------- 3-ZW) 제로월드: 페이지를 이동하지 않는다. 같은 페이지에서 선택을 확정하고 캡차만 남긴다 ---------- */
if (SITE.key === 'zeroworld') {
  const pick = await c.evaluate(`(${zwPick.toString()})(${JSON.stringify({ revDays: D, themeNum: T, themeTimeNum: String(hit.num) })})`)
    .catch((e) => ({ ok: false, msg: String(e.message) }));
  out('[PICK]', {
    ok: pick.ok, 시간: hit.time, themeTimeNum: hit.num, 시간클릭: pick.domClick, 버튼활성화: pick.btnActive,
    after_hit_ms: Date.now() - tHit, msg: pick.msg || '-',
  });
  const st0 = await c.evaluate(ZW_READ).catch((e) => ({ err: String(e.message) }));
  const hd = st0.hidden || {};
  out('[FORM]', {
    name: st0.name || '-', mobile: st0.mobile || '-', person: st0.person || '-', 캡차: st0.captcha || '-',
    zizum: hd.zizum_num || '-', rev_days: hd.rev_days || '-', theme: hd.theme_num || '-', time_num: hd.theme_time_num || '-',
  });
  if (st0.fillErr) log('[WARN] 입력기: ' + st0.fillErr);
  if (!pick.ok) log('[WARN] 시간 선택이 페이지에 반영되지 않았습니다. 브라우저에서 직접 선택해 주세요.');
  const zwWant = { zizum_num: Z, rev_days: D, theme_num: T, theme_time_num: String(hit.num) };
  log(AUTO_SUBMIT
    ? "[ARM] 자동등록방지 코드를 직접 입력하세요. 입력 완료 후 예약좌표/예약자/인원을 검증하고 '예약하기'를 1회 클릭합니다"
    : "[TODO] 자동등록방지 코드를 직접 입력하고 '예약하기'를 클릭하세요");
  const zwUntil = Date.now() + 6 * 60000;
  let zwDone = false;
  while (Date.now() < zwUntil && !zwDone) {
    const s = await c.evaluate(ZW_READ).catch(() => null);
    if (!s) break;
    if (!s.onZw) { log('[NAV] 페이지 이동 감지 — 브라우저에서 결과를 확인하세요'); zwDone = true; }
    else if (s.captcha === '입력됨' && !AUTO_SUBMIT) { log("[OK] 캡차 입력 감지 — 이제 '예약하기'만 클릭하세요"); zwDone = true; }
    else if (AUTO_SUBMIT && pick.ok) {
      const result = await c.evaluate(`(${zwSubmit.toString()})(${JSON.stringify({ want: zwWant, buyer: BUYER, preview: SUBMIT_PREVIEW })})`).catch(e => ({ ok: false, why: e.message }));
      if (result.ok) { log((SUBMIT_PREVIEW ? '[PREVIEW] ' : '[SUBMIT] ') + result.why); if (!SUBMIT_PREVIEW) log('[HANDOFF] 예약 결과를 브라우저에서 확인하세요. 오류가 나면 직접 수정해 주세요.'); zwDone = true; }
      else if (!/입력.*대기/.test(result.why)) { log('[ABORT] ' + result.why); zwDone = true; }
    }
    if (!zwDone) await sleep(AUTO_SUBMIT ? 200 : 700);
  }
  if (!zwDone) log('[IDLE] 6분 내 입력 없음. 준비 상태는 유지됩니다.');
  c.ws.close();
  process.exit(0);
}

/* ---------- 3) Step1 생략 직접 POST -> reservation2 ---------- */
const payload = { zizumNum: Z, themeNum: T, themeInfoNum: INFO, revDays: D, themeTimeNum: String(hit.num), revTimes: hit.time, themeName: TNAME };
const tPost = Date.now();
const tPage = await c.evaluate(`(${postNav.toString()})(${JSON.stringify(payload)})`).catch((e) => { log('[FAIL] POST 실패: ' + e.message); return 0; });
if (!tPage) { c.ws.close(); process.exit(4); }
log(`[POST] reservation2 제출 (히트 후 ${tPost - tHit}ms / 페이지 submit ${tPage - tHit}ms)`);

/* ---------- 4) 입력 완료 순간 포착 (loadEvent 기다리지 않음) ---------- */
// 이전 문서가 남긴 플래그로 측정이 속을 수 있다(실측: 히트 후 -89ms). 중복 클릭 방지(__SUBMITTED)는 그대로 둔다.
await c.evaluate('window.__FILL_AT=null; window.__FILL_MS=null; window.__FILL_ERR=null;').catch(() => {});
let fillAt = 0;
const fp = Date.now();
while (Date.now() - fp < 10000) {
  fillAt = await c.evaluate('window.__FILL_AT || null').catch(() => null);
  if (fillAt) break;
  await sleep(20);
}
// POST 직후에는 문서가 아직 교체 중이라 evaluate 가 실패하거나 빈 스냅샷이 나온다(실측) → 최대 5초 다시 읽는다
let st = await c.evaluate(STEP2_READ).catch((e) => ({ err: String(e.message) }));
for (let i = 0; i < 25 && (st.err || !st.onStep2); i++) {
  await sleep(200);
  st = await c.evaluate(STEP2_READ).catch((e) => ({ err: String(e.message) }));
}
if (st.err) log('[WARN] 스냅샷 읽기를 마칠 때까지 확인하지 못했습니다: ' + st.err);
out('[STEP2]', {
  url: st.url || '-', fill_ms: st.fillMs ?? '-', fill_after_hit_ms: fillAt ? fillAt - tHit : '-',
  name: maskName(st.name) || '-', mob: maskHp(st.mob) || '-', agree: st.agree || '-',
  상품: (st.good || '').slice(0, 60) || '-', 캡차: st.captcha > 0 ? '이미완료' : '미완료',
});
if (st.hidden) out('  예약좌표', st.hidden);
if (st.fillErr) log('[WARN] 입력기: ' + st.fillErr);
// 사이트가 devtools-detector 로 디버거를 감지하면 body 가 통째로 교체된다.
// 이 저장소의 기존 해제(ext/inject.js) 를 미리 걸어두므로 평상시에는 나오지 않는다.
// 만약 보이려면(해제 등록 전에 떠 있던 탭 등) → 해제를 다시 걸고 reservation2 를 한 번 더 연다.
if (st.blocked) {
  log('[UNLOCK] 차단 화면이 보입니다 — 해제를 다시 걸고 reservation2 를 한 번 더 엽니다');
  await applyUnlock(c, log);
  await c.evaluate(`(${postNav.toString()})(${JSON.stringify(payload)})`)
    .catch((e) => log('[UNLOCK] 재요청 실패: ' + e.message));
  await sleep(1500);
  const rg = await c.evaluate(STEP2_READ).catch(() => null);
  if (rg && !rg.blocked && rg.onStep2) {
    log('[UNLOCK] 복구됨 — 폼이 다시 그려졌습니다 (입력기/약관은 새 문서에서 재실행)');
    Object.assign(st, rg);
  } else {
    out('[BLOCK]', { 문구: BLOCK_MARK, after_hit_ms: Date.now() - tHit, 처리: '자동 진행 중단 (브라우저에서 직접 or --watch-only)' });
    log('[BLOCK] 해제 주입 후에도 차단 화면입니다 — UI 의 DevTools 배지(차단 해제) 후 재예약 or --watch-only 를 쓰세요');
    await shot('blocked');
    await handoff('사이트가 자동화를 차단함');
    c.ws.close(); process.exit(7);
  }
}

/* ---------- 5) reCAPTCHA 는 사람이 클릭 → 통과가 보이면 --auto-submit 일 때만 '예약하기' 1회 ---------- */
const WANT = { zizum_num: Z, theme_num: T, theme_info_num: INFO, rev_days: D, theme_time_num: String(hit.num) };
const runSubmit = (preview) => c
  .evaluate(`(${step2Submit.toString()})(${JSON.stringify({ want: WANT, agrees: AGREES, preview })})`)
  .catch((e) => ({ ok: false, why: 'evaluate 실패: ' + e.message }));

/** 스크린샷 한 장 남기고 (결제 화면 증거/사후 확인용) 파일 경로 로그 */
async function shot(tag) {
  try {
    const dir = fileURLToPath(new URL('./runs/', import.meta.url));
    fs.mkdirSync(dir, { recursive: true });
    const png = await c.send('Page.captureScreenshot', { format: 'png' });
    const file = `${dir}${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
    log('[SHOT] ' + file);
  } catch (e) { log('[WARN] 스크린샷 실패: ' + e.message); }
}

/** 검증 → 1회 클릭 → 결과 문구 관찰. 실패해도 재클릭 하지 않는다 (1 ID 1 테마 / 중복 결제 방지) */
async function autoSubmit() {
  const p = await runSubmit(true);
  out('[CHECK]', {
    버튼: p.btn || '-', 상품: p.good || '-', 금액: p.mny || '-',
    캡차토큰: p.captcha || 0, 폼검증: (p.problems || []).length ? '실패' : '통과', 문제: (p.problems || []).join(',') || '없음',
  });
  const r = await runSubmit(false);
  out('[SUBMIT]', { ok: r.ok, 버튼: r.btn || '-', 사유: r.why || '-', after_hit_ms: Date.now() - tHit });
  if (!r.ok) { log('[ABORT] 예약하기 를 누르지 않았습니다 — 브라우저에서 직접 클릭하세요 (재시도 없음)'); return; }
  const RES_RE = /예약\s*(완료|확정|성공)|결제가\s*완료|정상적으로|예약번호|매진|이미\s*예약|동시\s*접속|실패|오류/;
  const ru = Date.now() + 25000;
  let seen = '', lastUrl = '';
  while (Date.now() < ru) {
    const dlg = c.drain('Page.javascriptDialogOpening');
    if (dlg) {
      log('[ALERT] 사이트 메시지: ' + String((dlg.params && dlg.params.message) || '').replace(/\s+/g, ' ').slice(0, 120));
      await c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
    const t = await c.evaluate('(() => ({u: location.href.slice(0,110), t: (document.body && document.body.innerText || "").replace(/\\s+/g," ")}))()').catch(() => null);
    if (t) {
      lastUrl = t.u || lastUrl;
      const m = String(t.t || '').match(RES_RE);
      if (m) { seen = m[0]; break; }
    }
    await sleep(500);
  }
  out('[RESULT]', { 문구: seen || '미확인(화면 확인 필요)', url: lastUrl || '-' });
  await shot('submitted');
  log('[DONE] 클릭은 1회만 수행했습니다. 이후 결제 단계(사이트가 여는 별도 화면) 는 사람 확인 영역입니다');
}

if (SUBMIT_PREVIEW) {
  const p = await runSubmit(true);
  out('[PREVIEW]', {
    클릭대상: p.btn || '-', 상품: p.good || '-', 금액: p.mny || '-', 캡차토큰: p.captcha || 0,
    폼검증: (p.problems || []).length ? '실패' : '통과', 문제: (p.problems || []).join(',') || '없음',
  });
  const gate = (p.problems || []).length ? '폼 검증이 통과하지 못해 클릭 대상이 아닙니다'
    : (p.captcha ? '캡차 토큰 확인됨 — 지금 상태 그대로면 클릭 가능한 폼입니다'
      : '폼 검증 통과 — 사람이 reCAPTCHA 만 체크하면 바로 클릭됩니다');
  log(`[PREVIEW] ${gate} (아무것도 클릭하지 않았습니다)`);
  c.ws.close(); process.exit(0);
}
log(AUTO_SUBMIT
  ? "[ARM] reCAPTCHA '로봇이 아닙니다' 를 클릭하면 직후 '예약하기' 를 자동 클릭합니다 (토큰이 없으면 절대 누르지 않음)"
  : "[TODO] 1) reCAPTCHA '로봇이 아닙니다'  2) '예약하기' 클릭 — 이 두 동작은 직접 수행");
const until = Date.now() + 6 * 60000;
let done = false;
while (Date.now() < until && !done) {
  // 사이트가 alert() 를 띄우면 evaluate 가 막히므로 먼저 받아낸다 (문구는 로그에 남기고 닫는다)
  const dlg = c.drain('Page.javascriptDialogOpening');
  if (dlg) {
    log('[ALERT] 사이트 메시지: ' + String((dlg.params && dlg.params.message) || '').replace(/\s+/g, ' ').slice(0, 120));
    await c.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  }
  const s = await c.evaluate(STEP2_READ).catch(() => null);
  if (!s) break;
  if (s.blocked) {
    out('[BLOCK]', { 문구: BLOCK_MARK, 시점: '캡차 대기 중', 처리: '자동 진행 중단' });
    await shot('blocked-late');
    await handoff('캡차 대기 중 차단으로 전환');
    done = true; break;
  }
  if (s.captcha > 0) {
    done = true;
    out('[CAPTCHA]', { 토큰글자: s.captcha, after_hit_ms: Date.now() - tHit });
    if (AUTO_SUBMIT) await autoSubmit();
    else log("이제 '예약하기'만 클릭하세요");
  }
  else if (!s.onStep2) { log('[NAV] 페이지 이동 감지 — 브라우저에서 결과를 확인하세요'); done = true; }
  else await sleep(AUTO_SUBMIT ? 200 : 700);
}
if (!done) log('[IDLE] 6분 내 클릭 없음. 준비 상태는 유지됩니다.');
c.ws.close();
