/**
 * 사이트 등록부 - 키이스케이프 / 제로월드를 한 화면에서 다루기 위한 추상화
 *
 * 두 사이트는 예약엔진의 생김새가 전혀 다르다 (실측 2026-09):
 *   키이스케이프  POST /controller/run_proc.php  (JSON, t=get_theme_info_list/...)
 *                 reservation1.php --NEXT(POST)--> reservation2.php (이름/연락처3조각/약관2/reCAPTCHA)
 *   제로월드      POST /core/res/rev.make.sel.php (HTML 조각, act=theme_list/theme_time_list/...)
 *                 home.php?go=rev.make 한 페이지에서 작성 → /core/res/rev.act.php (이름/연락처1줄/인원/이미지captcha)
 *   단편선(dps)   아임웹 booking 위젯 — POST /booking/html_list.cm(월간 달력 HTML) + get_prod_list.cm(슬롯 JSON)
 *                 reserve_g?idx=…&day=… 슬롯 페이지 → 로그인 필수 '예약하기'(add_order.cm) → /shop_payment/
 *                 (이름/연락처/입금자명 + 결제수단 무통장입금). 디테일은 ./dps.mjs 주석에 실측 그대로 적어두었다.
 *
 * 화면이 다른 만큼 "지점/테마/슬롯/오픈시각" 을 사이트별 어댑터로 감춘다.
 */
import { getTimes as keGetTimes, getCalendar as keGetCalendar, openInfo as keOpenInfo, cdpList, BRANCHES, LEAD_DAYS_FALLBACK, sleep } from './lib.mjs';
import { DPS, dpsTimes, dpsOpenInfo, dpsProducts, dpsUrl, dpsLogin, dpsToday, parseDpsDay, dpsMonth } from './dps.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SITES = {
  keyescape: {
    key: 'keyescape', label: '키이스케이프', base: 'https://www.keyescape.com',
    step1: () => 'https://www.keyescape.com/reservation1.php',
    tabMatch: 'keyescape',
    branches: BRANCHES,
    buyerMode: 'mobile3', agrees: ['agree_1', 'agree_2'], captcha: 'reCAPTCHA',
    needsInfo: true, note: 'reservation2 에서 약관 2개 + reCAPTCHA 확인 후 예약하기 (사용자 2클릭)',
  },
  zeroworld: {
    key: 'zeroworld', label: '제로월드', base: 'https://zeroworldkorea.com',
    step1: (z) => `https://zeroworldkorea.com/layout/res/home.php?go=rev.make&s_subj=A&zizum_num=${z}`,
    tabMatch: 'zeroworld',
    // 김포본점(1) 은 사용자 요청으로 목록에서 제외 (사이트에는 존재하지만 이 도구에서 다루지 않는다)
    branches: [[4, '강남점'], [5, '홍대점']],
    buyerMode: 'mobile1line', agrees: [], captcha: '이미지 코드',
    needsInfo: false, note: '한 페이지에서 작성 → 이미지 코드 입력 후 예약하기 (제출은 rev.act.php, 대상 iframe ifr_ok)',
  },
  dps: {
    key: 'dps', label: DPS.label, base: DPS.base,
    step1: () => `${DPS.base}${DPS.page}`,
    tabMatch: 'dpsnnn',
    // 아임웹은 지점마다 메뉴가 따로 있다. 강남(/reserve_g) 만 등록 — 성수는 dpsnnn-s.imweb.me 별도 계정.
    branches: [[DPS.menuCode, '강남점']],          // zizum 자리에 아임웹 menu_code 가 들어간다
    buyerMode: 'name1line', agrees: [], captcha: '없음',
    needsInfo: false, login: 'required', deposit: true,
    openTime: DPS.openTime, leadDays: DPS.leadDays,
    note: '로그인 필수. 슬롯 페이지(reserve_g?idx=…) 에서 예약하기 → 결제화면에서 이름/연락처/입금자명 + 무통장입금. 최종 결제 진행은 사람이 클릭',
  },
};
export const siteOf = (k) => SITES[String(k || 'keyescape').toLowerCase()] || SITES.keyescape;

/* ===================== 제로월드: rev.make.sel.php ===================== */
const ZW_URL = 'https://zeroworldkorea.com/core/res/rev.make.sel.php';
const ZW_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const ZW_HDR = {
  'User-Agent': ZW_UA,
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://zeroworldkorea.com/layout/res/home.php?go=rev.make&s_subj=A&zizum_num=5',
};
const DAY_MS = 86400000;
const stripTags = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** KST 벽시계 기준 오늘 + n일 (사이트 달력은 KST) */
export const zwDate = (offset = 0) => new Date(Date.now() + 9 * 3600 * 1000 + offset * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
const hhmm = (t) => (String(t || '').length === 4 ? '0' + t : String(t || ''));
/** '예약 오픈시간은 12:00 입니다' → '12:00' (지점별 매일 오픈 시각이 이 문구에 있다) */
const zwOpenTimeOf = (html) => hhmm((String(html).match(/오픈\s*시간은?\s*:?\s*(\d{1,2}:\d{2})/) || [])[1] || '');

/** 지점별 매일 오픈 시각은 그 날 오픈 전에만 문구로 나타난다 → 읽는 즉시 파일에 기억한다 */
const ZW_TFILE = path.join(HERE, 'zw-open-times.json');
const zwReadOpenTimes = () => { try { return JSON.parse(fs.readFileSync(ZW_TFILE, 'utf8')); } catch { return {}; } };
function zwRememberOpenTime(zizum, t) {
  if (!t) return;
  const m = zwReadOpenTimes();
  if (m[zizum]?.time === t) return;
  m[zizum] = { time: t, at: new Date().toISOString() };
  try { fs.writeFileSync(ZW_TFILE, JSON.stringify(m, null, 1) + '\n'); } catch { /* 읽기 전용 매체라면 그냥 넘긴다 */ }
}

async function zwSel(data, timeout = 9000) {
  const res = await fetch(ZW_URL, { method: 'POST', headers: ZW_HDR, body: data, signal: AbortSignal.timeout(timeout) });
  return await res.text();
}

/** 지점의 테마 목록 → [{theme,name,genre,level,play,minPerson}] */
export async function zwThemes(zizum, refDate = zwDate(0)) {
  const html = await zwSel(`act=theme_list&zizum_num=${Number(zizum)}&rev_days=${refDate}&theme_num=&s_subj=A`);
  const picks = [...html.matchAll(/fun_theme_select\('(\d+)','\d+'\)/g)].map((m) => m[1]);
  const names = [...html.matchAll(/choice-themes__name">([^<]+)</g)].map((m) => m[1].trim());
  const genres = [...html.matchAll(/choice-themes__genre">([^<]+)</g)].map((m) => m[1].trim());
  const themes = picks.map((theme, i) => ({
    theme: Number(theme), info: Number(theme), name: names[i] || `테마 ${theme}`,
    genre: genres[i] || '', level: '', play: '', minPerson: null, doing: null, notice: '',
  }));
  for (const t of themes) {   // 러닝타임/가능인원 은 theme_select 응답에만 있다
    const d = await zwSel(`act=theme_select&theme_num=${t.theme}&rev_days=${refDate}&theme_time_num=`).catch(() => '');
    const txt = stripTags(d);
    const pr = txt.match(/(\d+)-(\d+)인/);
    t.play = (txt.match(/(\d{2})\s+(\d+)-\d+인/) || [])[1] || '';
    t.personRange = pr ? pr[0] : '';
    t.minPerson = pr ? Number(pr[1]) : null;
    t.level = String((d.match(/level__bullet full/g) || []).length);
    await sleep(120);
  }
  return { ok: themes.length > 0, themes, msg: themes.length ? '' : stripTags(html).slice(0, 120) };
}

/**
 * 그 날짜의 시간대 → slots[{num,time,open}] + 미오픈 문구/지점 오픈시각.
 * **달력 창 밖 날짜는 무조건 '아직 오픈 전' 으로 취급한다** — 서버는 창 밖 날짜에도
 * 기본 시간표를 그냥 뱉기 때문에(실측: 창 끝이 9/22 인데 9/24~10/2 가 시간표 출력),
 * 시간 목록이 떴다는 사실만으로 열렸다고 판단하면 안 된다.
 */
export async function zwTimes(zizum, theme, date) {
  const win = await zwReserveWindow(zizum, theme);
  if (win.windowEnd && date > win.windowEnd) {
    return { ok: false, msg: `달력 예약 창 밖 (창 끝 ${win.windowEnd})`, openTime: win.openTime || null, slots: [], outside: true };
  }
  return await zwTimesRaw(zizum, theme, date);
}

async function zwTimesRaw(zizum, theme, date) {
  const html = await zwSel(`act=theme_time_list&zizum_num=${Number(zizum)}&rev_days=${date}&theme_num=${Number(theme)}`);
  const openTime = zwOpenTimeOf(html);
  if (openTime || /not-choice/.test(html)) {
    zwRememberOpenTime(zizum, openTime);   // 지점별 매일 오픈 시각을 여기서 배운다
    return { ok: false, msg: stripTags(html).slice(0, 120) || '예약 오픈 전입니다', openTime: openTime || null, slots: [] };
  }
  const slots = [...html.matchAll(/<a class="choice-time__time([^"]*)"[^>]*?(?:href="javascript:fun_theme_time_select\('(\d+)','\d+'\)"[^>]*)?>([^<]+)</g)]
    .map((m) => ({
      num: Number(m[2] || 0), time: m[3].trim(), open: !/disable/.test(m[1]),
      enable: /disable/.test(m[1]) ? 'N' : 'Y', hh: m[3].slice(0, 2), mm: m[3].slice(3, 5), sale: '',
    }));
  const c = stripTags(html).match(/(\d+)\/(\d+)\s*가능/);
  return {
    ok: true, msg: c ? c[0] : '', openTime: null,
    slots, open: c ? Number(c[1]) : slots.filter((s) => s.open).length, total: c ? Number(c[2]) : slots.length,
  };
}

/**
 * 제로월드 예약 창 - 기준은 **달력의 클릭 가능한 날짜** 다 (실측 2026-09-08, 세 지점 모두 오늘~+14).
 *   · 시간 목록(act=theme_time_list) 은 창 밖 날짜에도 기본 시간표를 뱉는다 → 창 크기 재는 데 쓰면 안 된다.
 *   · 창 안이되 아직 안 열린 날짜만 "예약 오픈시간은 HH:MM 입니다" 가 뜬다 → 여기서 지점별 오픈 시각을 배운다.
 *   · 창 끝 W 는 매일 그 시각에 하루 밀린다. 고로  openAt(목표일) = 오늘 + (목표일 - W) at HH:MM
 *     (오픈 전이든 후든 같은 식이다: 오픈 후 W 는 이미 열린 날짜이므로 openAt(W)=오늘 HH:MM = 방금 지나간 시각)
 *   실측: 11:31 강남(11:30 오픈) 은 W=9/22 가 이미 시간 목록 / 홍대(12:00 오픈) 는 W=9/22 가 아직 문구.
 */
export async function zwCalendarDates(zizum, refDate = zwDate(0)) {
  const d0 = new Date(refDate + 'T00:00:00Z');
  const out = new Set();
  for (let i = 0; i < 2; i++) {   // 창이 다음 달을 넘어갈 수 있어 두 달치 본다
    const mo = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1));
    const html = await zwSel(`act=calendar&zizum_num=${Number(zizum)}&rev_days=${refDate}`
      + `&year=${mo.getUTCFullYear()}&month=${mo.getUTCMonth() + 1}&s_subj=A`);
    for (const m of html.matchAll(/fun_days_select\('(\d{4}-\d{2}-\d{2})'/g)) out.add(m[1]);
    await sleep(130);
  }
  return [...out].filter((d) => d >= refDate).sort();
}

const ZW_CACHE = new Map();
export async function zwReserveWindow(zizum, theme, ttl = 300000) {
  const key = `${zizum}:${theme}`;
  const hit = ZW_CACHE.get(key);
  const nowK = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  // 스캔이 "오늘 그 지점 오픈 시각 이전" 이었고 지금은 그 시각을 지났다면 캐시를 버린다
  // (열린 뒤에도 "아직 안 열림" 으로 보이는 오류 — 키이스케이프 오픈 전 스캔과 같은 종류)
  const crossed = !!hit?.openTime && hit.scanAt?.slice(0, 10) === nowK.slice(0, 10)
    && hit.scanAt.slice(11, 16) < hit.openTime && nowK.slice(11, 16) >= hit.openTime;
  if (hit && !crossed && Date.now() - hit.at < ttl) return hit;
  const today = zwDate(0);
  const dates = await zwCalendarDates(zizum, today);
  const windowEnd = dates.length ? dates[dates.length - 1] : null;
  const atEnd = windowEnd ? await zwTimesRaw(zizum, theme, windowEnd) : { ok: false, openTime: null, msg: '달력이 비어 있음' };
  const openTime = atEnd.openTime || zwReadOpenTimes()[zizum]?.time || '';
  const out = {
    at: Date.now(), scanAt: nowK, today, dates, windowEnd, openTime,
    leadDays: windowEnd ? dayDiff(windowEnd, today) : null,
    lockedAtEnd: !atEnd.ok,                      // 창 끝이 아직 안 열림 = 오늘 openTime 에 열리는 날짜
    lastMsg: atEnd.msg || '',
    openTimeAged: !atEnd.openTime && !!openTime, // 오늘 문구는 못 읽고 기억하던 시각을 쓴다
  };
  ZW_CACHE.set(key, out);
  return out;
}

/** 제로월드: 그 날짜가 예약 열리는 시각 */
export async function zwOpenInfo({ zizum, theme, date }) {
  const win = await zwReserveWindow(zizum, theme);
  const base = {
    site: 'zeroworld', branch: (SITES.zeroworld.branches.find(([n]) => n === Number(zizum)) || [])[1] || String(zizum),
    openTime: win.openTime || null,
    openTimeSource: win.openTime
      ? (win.openTimeAged ? `과거에 읽은 문구(기억: ${win.openTime})` : '서버 응답 문구(예약 오픈시간은 HH:MM)')
      : '',
    leadDays: win.leadDays,
    leadSource: win.windowEnd
      ? `달력 예약 창 끝 ${win.windowEnd} = 오늘 +${win.leadDays}일${win.lockedAtEnd ? ' (아직 미오픈 → 오늘 열림)' : ' (오늘 오픈 완료)'}`
      : '달력이 비어 있음',
    today: win.today, windowEnd: win.windowEnd, preOpenScan: !!win.lockedAtEnd,
    date: date || null,
  };
  if (!date) return { ok: false, ...base, note: '날짜 미선택' };
  if (!win.windowEnd) return { ok: false, ...base, note: base.leadSource };
  if (!win.openTime) return { ok: false, ...base, note: '오픈 시각을 사이트에서 읽지 못했습니다 — 오늘 오픈 전에 조회하면 시각을 기억합니다' };
  const shift = dayDiff(date, win.windowEnd);   // windowEnd = 오늘 열리는(열린) 날짜
  const openDate = new Date(Date.parse(win.today + 'T00:00:00Z') + shift * DAY_MS).toISOString().slice(0, 10);
  const openAt = `${openDate}T${hhmm(win.openTime)}:00+09:00`;
  return {
    ok: true, ...base, openDate, openAt, msUntil: Date.parse(openAt) - Date.now(),
    past: Date.parse(openAt) < Date.now(), inWindow: date <= win.windowEnd,
    note: win.lockedAtEnd ? '' : '이 창 안의 날짜는 이미 열려 있습니다',
  };
}

const REGION = /^(서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충남|충북|전남|전북|경남|경북|제주)/;
/** .rese-spot__btn 안에 "지점명 + 지역" 이 함께 들어 있다 → 지점명만 남긴다 */
function zwBranchName(html) {
  const t = stripTags(html).replace(/^제로월드\s*-\s*/, '').trim();
  const keep = [];
  for (const w of t.split(/\s+/)) { if (REGION.test(w)) break; keep.push(w); }
  return keep.join(' ') || t;
}

/** 지점 목록을 페이지에서 갱신 (실패 시 내장 표). 페이지에 새로 생겨도 내장 목록의 지점만 쓴다(김포본점 제외) */
const ZW_BRANCH_CACHE = { at: 0, branches: null };
export async function zwBranches(force = false) {
  if (!force && ZW_BRANCH_CACHE.branches && Date.now() - ZW_BRANCH_CACHE.at < 1800000) return ZW_BRANCH_CACHE.branches;
  try {
    const html = await fetch('https://zeroworldkorea.com/layout/res/home.php?go=rev.make&s_subj=A&zizum_num=5',
      { headers: { 'User-Agent': ZW_UA }, signal: AbortSignal.timeout(9000) }).then((r) => r.text());
    const scraped = [];
    for (const m of html.matchAll(/go=rev\.make&s_subj=A&zizum_num=(\d+)"[^>]*>([\s\S]{0,420}?)<\/a>/g)) {
      const nm = zwBranchName(m[2]);
      if (nm && !scraped.some(([n]) => n === Number(m[1]))) scraped.push([Number(m[1]), nm]);
    }
    // 페이지에는 김포본점 등 다른 지점도 뜬다 → 내장 목록(강남/홍대)에 있는 것만 쓰고 이름은 페이지 것으로 갱신
    const list = SITES.zeroworld.branches.map(([n, fb]) => scraped.find(([s]) => s === n) || [n, fb]);
    if (list.length) { ZW_BRANCH_CACHE.at = Date.now(); ZW_BRANCH_CACHE.branches = list; return list; }
  } catch { /* 오프라인 → 내장 표 */ }
  return SITES.zeroworld.branches;
}

/* ===================== 라우터가 쓰는 공통 façade ===================== */
export async function apiTimes(site, zizum, theme, date) {
  const k = siteOf(site).key;
  if (k === 'zeroworld') return await zwTimes(zizum, theme, date);
  if (k === 'dps') return await dpsTimes(date);                 // 달력 한 장에 그 달 전체 슬롯이 있다
  return await keGetTimes(zizum, theme, date);
}
export async function apiOpenInfo(site, { zizum, theme, info, date }) {
  const k = siteOf(site).key;
  if (k === 'zeroworld') return await zwOpenInfo({ zizum, theme, date });
  if (k === 'dps') return await dpsOpenInfo({ date });
  return await keOpenInfo({ zizum, theme, info, date });
}
export async function apiBranches(site) {
  const k = siteOf(site).key;
  if (k === 'zeroworld') return await zwBranches();
  if (k === 'dps') return SITES.dps.branches;
  return SITES.keyescape.branches;
}
/** 테마(=슬롯 상품) 목록: 키이스케이프/제로월드는 지점별, 단편선은 강남 이야기×시간대 18종 */
export async function apiThemes(site, zizum) {
  const k = siteOf(site).key;
  if (k === 'zeroworld') return await zwThemes(zizum);
  if (k === 'dps') {
    const themes = await dpsProducts().catch(() => []);
    return { ok: themes.length > 0, themes, msg: themes.length ? '' : 'get_prod_list.cm 이 빈 목록을 주었습니다' };
  }
  return null;   // 키이스케이프는 서버 응답 조합이 따로 필요해 server.mjs 에서 처리한다
}
export async function apiToday(site, info) {
  const k = siteOf(site).key;
  if (k === 'dps') return dpsToday();
  if (k === 'zeroworld') return zwDate(0);
  const cal = await keGetCalendar(Number(info) || 34).catch(() => null);
  return cal?.calendarData?.today || zwDate(0);
}
export { LEAD_DAYS_FALLBACK, DPS, dpsTimes, dpsOpenInfo, dpsProducts, dpsUrl, dpsLogin, dpsToday, parseDpsDay, dpsMonth };
export { dpsFiller, dpsBook, dpsSlotRead, dpsOrderRead, dpsLoginRead } from './dps.mjs';

/* ===================== 브라우저 측 (CDP 로 문자열화해 주입) ===================== */
/** 사이트 탭을 찾거나 연다 (제로월드는 zizum 이 url 에 들어간다) */
export async function siteTab(port, site, zizum, create = true) {
  const s = siteOf(site);
  const url = s.step1(zizum);
  const list = await cdpList(port);
  if (!list) return { ok: false, msg: `CDP(:${port}) 응답 없음 — ../unlock.sh 실행 필요` };
  let tab = list.find((t) => t.type === 'page' && t.url.includes(s.tabMatch));
  if (!tab) {
    if (!create) return { ok: false, msg: `${s.label} 탭 없음 (예약을 실행하면 열립니다)` };
    const n = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      .then((r) => r.json()).catch(() => null);
    if (!n?.webSocketDebuggerUrl) return { ok: false, msg: `${s.label} 탭 개설 실패` };
    await sleep(3500);
    tab = n;
  }
  return { ok: true, tab, url, site: s.key, tabs: list.filter((t) => t.type === 'page').map((t) => t.url.slice(0, 90)) };
}

/** 제로월드 페이지 주입 입력기: 예약자명/연락처(1줄)/인원 을 폼이 준비되는 즉시 채운다 (제출은 하지 않는다) */
export function zwFiller(WANT) {
  const t0 = performance.now();
  const setV = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tick = () => {
    const f = document.register;
    if (!f) {
      if (performance.now() - t0 > 20000) { window.__FILL_ERR = 'register 폼을 찾지 못함'; return; }
      requestAnimationFrame(tick); return;
    }
    let miss = false;
    for (const k in WANT) {
      const el = f[k];
      const v = String(WANT[k]);
      if (!el) { miss = true; continue; }
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) { miss = true; continue; }
      if (String(el.value) !== v) setV(el, v);
    }
    if (!miss) { window.__FILL_MS = performance.now() - t0; window.__FILL_AT = Date.now(); return; }
    if (performance.now() - t0 > 20000) { window.__FILL_ERR = '입력 필드 대기 타임아웃 (인원 선택 목록이 안 떴을 수 있음)'; return; }
    requestAnimationFrame(tick);
  };
  tick();
}

/** 히트 순간: 페이지의 날짜/테마/시간 선택 상태를 만들고 예약하기 버튼을 활성화한다 (클릭/제출은 하지 않는다) */
export async function zwPick(P) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const f = document.register;
  if (!f) return { ok: false, msg: 'register 폼을 찾지 못함' };
  const set = (k, v) => { if (f[k]) f[k].value = String(v); };
  set('rev_days', P.revDays); set('theme_num', P.themeNum); set('theme_time_num', P.themeTimeNum);
  const needle = "fun_theme_time_select('" + P.themeTimeNum + "'";
  const a = [...document.querySelectorAll('#theme_time_data a')].find((x) => (x.getAttribute('href') || '').indexOf(needle) === 0);
  if (a) a.click();
  else if (typeof fun_theme_time_select === 'function') fun_theme_time_select(P.themeTimeNum, 0);
  await wait(400);
  set('rev_days', P.revDays); set('theme_num', P.themeNum); set('theme_time_num', P.themeTimeNum);   // ajax 가 초기화했으니 다시 박는다
  const btn = document.querySelector('.rese-form__button');
  if (btn && !btn.classList.contains('is-active')) btn.classList.add('is-active');
  const warn = document.querySelector('.rese-form__warning');
  if (warn) warn.classList.remove('is-active');
  return {
    ok: !!(f.theme_time_num && f.theme_time_num.value),
    time: f.theme_time_num ? f.theme_time_num.value : '', domClick: !!a,
    btnActive: !!(btn && btn.classList.contains('is-active')), url: location.href.slice(0, 90),
  };
}

/** 제로월드 작성 폼 읽기 전용 스냅샷 */
export const ZW_READ = `(() => {
  const f = document.register;
  const val = (n) => { const e = f ? f[n] : null; return e ? String(e.value || '') : null; };
  const txt = document.body.innerText.replace(/\\s+/g, ' ');
  const btn = document.querySelector('.rese-form__button');
  return {
    onZw: /rev\\.make/.test(location.pathname), url: location.href.slice(0, 120),
    fillAt: window.__FILL_AT || null, fillMs: window.__FILL_MS === undefined ? null : window.__FILL_MS,
    fillErr: window.__FILL_ERR || null,
    name: val('name'), mobile: val('mobile'), person: val('person'),
    hidden: { zizum_num: val('zizum_num'), rev_days: val('rev_days'), theme_num: val('theme_num'), theme_time_num: val('theme_time_num') },
    captcha: val('input_captcha') ? '입력됨' : '비어있음',
    btnActive: !!(btn && btn.classList.contains('is-active')),
    times: [...document.querySelectorAll('#theme_time_data a')].map((a) => (a.innerText || '').trim() + (/disable/.test(a.className) ? '(마감)' : '')).slice(0, 12),
    msg: (txt.match(/선택완료|예약확정|예약일|시간 선택/) || [''])[0]
  };
})()`;


