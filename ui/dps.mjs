/**
 * 단편선(dpsnnn.com, 예약/강남 = /reserve_g) 사이트 어댑터
 *
 * 호스팅: 아임웹(imweb). 예약은 `booking` 모듈 + React 기반 <booking-widget>(MFE).
 * 실측 (2026-09-09, 비로그인):
 *   · 월간 캘린더  POST /booking/html_list.cm (target_month, menu_code) → HTML 약 104KB
 *       일셀  <td class="booking_day pc_day [full_day] [holiday] [today]" data-date="2026-9-16">
 *       슬롯  <div class="booking_list waiting closed disable">
 *                 <a href="reserve_g?idx=25&day=20260910" onclick="return false">
 *                   <span class="booking_badge" style="background:#fa565a">완</span>
 *                   <span class="text">상자 / 10:00</span></a></div>
 *       뱃지  가(#8EC31F)=예약가능 / 대=입금대기 / 완(#fa565a)=완료 · 셀 전체 `예약불가`=아직 미오픈 · `예약 종료`=지난 날
 *   · 슬롯 목록   POST /booking/get_prod_list.cm (menu_code) → {total:[{idx,code,name:"상자 / 10:00"}…]}
 *   · 예약하기    SITE_MEMBER.openLogin(…, function(){SITE_BOOKING.addBooking(false)}, …) → **로그인 필수**
 *   · addBooking  #booking_f serialize → POST /booking/add_order.cm → 주문 생성 → 결제화면 /shop_payment/?order_code=…
 *                 (그 화면에서 주문자명/연락처/**입금자명** · 결제수단(무통장입금) 을 고른다)
 *   · 오픈 규칙    공지 원문 "매일 자정에 다음주 해당 요일의 슬롯이 오픈됩니다" → openAt(D) = (D-7일) 00:00 KST
 *   · 로그인 마커  로그아웃 = `.member-info.guest` + "로그인이 필요합니다." / 로그인 = `a[href="/logout.cm"]`
 *   · devtools-detector 류 디버거 차단은 없다 (키이스케이프와 달라서 해제를 걸지 않는다)
 *
 * 정책: 자동등록방지는 없지만, 주문 생성과 결제는 사람 계좌에서 돈이 나가는 동작이다.
 *       따라서 ① 조회 ② 로그인 확인 ③ 폼 채움 ④(opt-in) '예약하기' 1회 클릭까지만 하고,
 *       결제화면의 **최종 결제 진행은 절대 대신 클릭하지 않는다**.
 */
import { cdp, cdpList } from './lib.mjs';

export const DPS = {
  base: 'https://www.dpsnnn.com',
  page: '/reserve_g',
  label: '단편선(강남)',
  // 페이지 안 init_calendar({...}) / 위젯 부트스트랩에서 실측한 상수
  menuCode: 'm2021111422e8d3a51ef50',
  widgetIdx: '839631993',
  siteCode: 'S202111149ffd142d97b50',
  unitCode: 'u202111146190f4e783eb7',
  openTime: '00:00',      // 공지: 매일 자정
  leadDays: 7,            // D-7 자정 오픈 (실측 9/9 조회 → 9/15까지 노출, 9/16~ 예약불가)
};

export const dpsUrl = (idx, day) =>
  `${DPS.base}${DPS.page}?idx=${encodeURIComponent(idx)}${day ? `&day=${String(day).replace(/-/g, '')}` : ''}`;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const HDR = () => ({
  'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest', 'Referer': `${DPS.base}${DPS.page}`, 'Origin': DPS.base,
});
const DAY_MS = 86400000;
const strip = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** KST 벽시계 오늘 (사이트 달력은 KST) */
export const dpsToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const dpsYm = (date) => String(date || dpsToday()).slice(0, 7);

async function post(path, data, timeout = 12000) {
  const res = await fetch(DPS.base + path, {
    method: 'POST', headers: HDR(), body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: res.status, text: await res.text() };
}

/** 슬롯(상품) 목록 = 이야기 × 시간대. UI 의 테마 드롭다운 재료 (30분 기억) */
export async function dpsProducts(force = false) {
  if (!force && DPS._prod && Date.now() - DPS._prod.at < 1800000) return DPS._prod.list;
  const { status, text } = await post('/booking/get_prod_list.cm', { menu_code: DPS.menuCode });
  if (status !== 200) throw new Error(`get_prod_list.cm HTTP ${status}`);
  const o = JSON.parse(text);
  const list = (o.total || []).map((p) => {
    const parts = String(p.name || '').split('/');
    return {
      theme: Number(p.idx), info: Number(p.idx), name: String(p.name || `슬롯 ${p.idx}`).trim(),
      story: (parts[0] || '').trim(), time: (parts[1] || '').trim(),
      genre: '', level: '', play: '', minPerson: null, notice: '',
    };
  }).filter((p) => p.theme);
  DPS._prod = { at: Date.now(), list };
  return list;
}

/** 월간 캘린더 원문 (폴링은 이 한 통으로 한다 — 일셀 안에 슬롯 전부가 들어 있다) */
export async function dpsMonth(month = dpsYm(), timeout = 12000) {
  const { status, text } = await post('/booking/html_list.cm', { target_month: month, menu_code: DPS.menuCode }, timeout);
  if (status !== 200) throw new Error(`html_list.cm HTTP ${status}`);
  return text;
}

/**
 * 월간 캘린더 HTML 에서 그 날짜 셀만 골라 슬롯 상태를 뽑는다 (순수 함수 → 단위 테스트 가능).
 * "열렸다" 의 기준은 **화살표가 실제로 눌리는가** 다: 래퍼에 closed/disable 이 없고, 앵커에
 * `return false` 가 없고, 뱃지가 가(#8EC31F) 일 때만 open. 모호하면 닫힌 것으로 본다
 * (오탐 → 엉뚱한 주문이 만들어지므로 fail-closed 가 안전하다).
 */
export function parseDpsDay(html, date) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!y || !m || !d) return { ok: false, msg: `날짜 형식 오류: ${date}`, slots: [] };
  const key = `${y}-${m}-${d}`;                       // 사이트의 data-date 는 zero-padding 이 없다
  const h = String(html || '');
  const cell = h.match(new RegExp('<td[^>]*data-date="' + key + '"[^>]*>([\\s\\S]*?)</td>', 'i'));
  if (!cell) return { ok: false, msg: `${key} 셀이 달력에 없습니다 (조회 월 ${dpsYm(date)} 확인)`, slots: [], missing: true };
  const cls = (h.match(new RegExp('<td[^>]*class="([^"]*)"[^>]*data-date="' + key + '"', 'i')) || [])[1] || '';
  const body = cell[1];
  const noteM = strip(body).match(/(예약\s*불가|예약\s*종료)/);
  const note = noteM ? noteM[1].replace(/\s+/g, '') : '';
  const slots = [];
  for (const it of body.matchAll(/<div class="booking_list([^"]*)"[^>]*>([\s\S]*?)<\/a><\/div>/gi)) {
    const wrapCls = 'booking_list' + it[1];
    const inner = it[2];
    const a = (inner.match(/<a\s[^>]*>/i) || [''])[0];
    const href = (a.match(/href="([^"]+)"/i) || [])[1] || '';
    const idx = (href.match(/idx=(\d+)/) || [])[1] || '';
    const day = (href.match(/day=(\d{8})/) || [])[1] || '';
    const badgeM = inner.match(/<span class="booking_badge[^"]*"[^>]*>([^<]*)</i);
    const badge = (badgeM ? badgeM[1] : '').trim();
    const color = (inner.match(/class="booking_badge[^"]*"\s+style="background:\s*(#[0-9a-fA-F]{6})/i) || [])[1] || '';
    const label = ((inner.match(/<span class="text">([^<]*)</i) || [])[1] || '').trim();
    const dead = /closed|disable/i.test(wrapCls) || /return false/i.test(a);
    slots.push({
      num: Number(idx), theme: Number(idx), idx: Number(idx), day,
      name: label, time: (label.split('/')[1] || '').trim(),
      badge, color,
      open: !dead && (badge === '가' || /8ec31f/i.test(color)),
      url: dpsUrl(idx, day), cls: wrapCls.trim(),
    });
  }
  return {
    ok: true, date, key, cellClass: cls.trim(), msg: note,
    notOpen: /full_day/i.test(cls) || !!note, past: /종료/.test(note),
    slots, open: slots.filter((s) => s.open).length, total: slots.length,
  };
}

/** 그 날짜 슬롯 상태 → 런너가 쓰는 공통 모양 {ok,msg,slots[{num,time,open,…}]} (달이 다르면 한 번 더 본다) */
export async function dpsTimes(date, month = dpsYm(date)) {
  try {
    const r = parseDpsDay(await dpsMonth(month), date);
    if (r.missing && dpsYm(date) !== month) return await dpsTimes(date, dpsYm(date));
    return r;
  } catch (e) { return { ok: false, msg: String(e && e.message || e).slice(0, 90), slots: [] }; }
}

/** 그 날짜가 예약으로 열리는 시각 (공지: 매일 자정 / D-7) + 달력 실측 창 끝 */
export async function dpsOpenInfo({ date } = {}) {
  const today = dpsToday();
  const base = {
    site: 'dps', branch: DPS.label, openTime: DPS.openTime,
    openTimeSource: '사이트 공지 — "매일 자정에 다음주 해당 요일의 슬롯이 오픈됩니다"',
    leadDays: DPS.leadDays, today, date: date || null,
  };
  if (!date) return { ok: false, ...base, note: '날짜 미선택' };
  const shift = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS);
  if (shift < 0) return { ok: false, ...base, note: '지난 날짜입니다', past: true };
  const openDate = new Date(Date.parse(today + 'T00:00:00Z') + (shift - DPS.leadDays) * DAY_MS).toISOString().slice(0, 10);
  const openAt = `${openDate}T${DPS.openTime}:00+09:00`;
  let windowEnd = null;
  try {
    const html = await dpsMonth(dpsYm(today));
    for (let i = 0; i < 10; i++) {
      const dd = new Date(Date.parse(today + 'T00:00:00Z') + i * DAY_MS).toISOString().slice(0, 10);
      const one = parseDpsDay(html, dd);
      if (one.missing) break;
      if (one.ok && !one.notOpen && one.total > 0) windowEnd = dd;
    }
  } catch { /* 오프라인이면 공지 기반 값만 쓴다 */ }
  const lead = windowEnd ? Math.round((Date.parse(windowEnd + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS) : null;
  return {
    ok: true, ...base, openDate, openAt, msUntil: Date.parse(openAt) - Date.now(),
    past: Date.parse(openAt) < Date.now(), inWindow: windowEnd ? date <= windowEnd : null,
    windowEnd, leadDaysObserved: lead,
    leadSource: windowEnd ? `달력 실측 창 끝 ${windowEnd} (오늘 +${lead}일)` : '달력 실측 실패 → 공지 기준(D-7 자정)',
    note: shift > DPS.leadDays ? '창 밖 날짜입니다 — 위 openAt 에 열립니다' : '이미 창 안의 날짜입니다',
  };
}

/** ── 로그인 상태 ──────────────────────────────────────────────────────────────
 *  단편선은 '예약하기' 가 SITE_MEMBER.openLogin(...) 으로 감싸여 있어 **로그인되어 있어야 예약이 된다**.
 *  (강남/성수는 계정을 공유하지 않는다는 공지도 있다 → 사이트마다 따로 확인해야 한다)
 *  마커: 로그아웃 = `.member-info.guest` + "로그인이 필요합니다." / 로그인 = `a[href="/logout.cm"]` */
/**
 * 로그인 상태 읽기 (브라우저에서 실행될 함수 — toString() 으로 직렬해 넣는다.
 * 문자열 템플릿으로 쓰면 \\s 같은 이스케이프가 깨진 실측 사례가 있어 함수로 보낸다)
 */
export function dpsLoginRead() {
  const txt = (e) => (e && e.innerText ? e.innerText.replace(/\s+/g, ' ').trim() : '');
  const guest = document.querySelector('.member-info.guest');
  const mem = document.querySelector('.member-info:not(.guest)');
  return {
    href: location.href.slice(0, 90),
    guest: document.body ? /로그인이\s*필요합니다/.test(document.body.innerText || '') : false,
    guestClass: !!guest,
    memberBlock: !!mem,
    member: txt(mem).slice(0, 30),
    isGuestFlag: typeof window.IS_GUEST === 'boolean' ? window.IS_GUEST : null,
  };
}

/**
 * 판단 우선순위 (실측 함정: 알림 드로어 템플릿에는 로그인 상태와 무관하게 '로그아웃' 링크가 항상 있다):
 *   ① guest 마커(`.member-info.guest` / "로그인이 필요합니다.") 보이면 **로그아웃**
 *   ② 그다음 guest 가 아닌 member-info 블록이 있으면 **로그인됨**
 *   ③ 사이트가 노출하는 IS_GUEST 플래그로 마지막 판단, 그래도 없으면 null (있다고 지어내지 않는다)
 */
export function parseDpsLogin(j) {
  if (!j) return { ok: false, loggedIn: null, msg: '응답 없음' };
  const guest = !!(j.guest || j.guestClass);
  const loggedIn = guest ? false
    : (j.memberBlock ? true : (typeof j.isGuestFlag === 'boolean' ? !j.isGuestFlag : null));
  // 회원 블록 텍스트에는 실명 + 이메일이 섞여 있다('홍길동 hong@…') → 로그/UI 배지에 그대로 남기지 않는다
  const who = (() => {
    const first = String(j.member || '').split(/[\s(]+/).filter(Boolean)[0] || '';
    if (!first || first === '로그인됨') return '회원';
    return first[0] + '*'.repeat(Math.max(1, first.length - 1));
  })();
  return {
    ok: loggedIn !== null, loggedIn,
    msg: loggedIn === true ? `로그인됨 (${who})`
      : loggedIn === false ? '로그아웃 — 예약하기를 누르면 로그인 창이 먼저 뜹니다'
        : '로그인 상태를 판단할 수 없습니다 (마커 없음)',
    href: j.href || '', source: j.source || '',
  };
}

/** 탭이 있으면 그 문서에서 읽고, 없으면 브라우저 쿠키로 페이지를 내려받아 판단한다 (탭을 새로 만들지는 않는다) */
export async function dpsLogin(port = 9222) {
  const list = await cdpList(port);
  const tab = list && list.find((t) => t.type === 'page' && /dpsnnn\.com/.test(t.url || ''));
  if (tab) {
    const c = cdp(tab.webSocketDebuggerUrl);
    try {
      await c.ready;
      await c.send('Runtime.enable').catch(() => {});
      const j = await c.evaluate(`(${dpsLoginRead.toString()})()`);
      return { ...parseDpsLogin({ ...j, source: '브라우저 탭 실측' }), tab: true };
    } catch (e) {
      return { ok: false, loggedIn: null, msg: '탭 읽기 실패: ' + String(e.message).slice(0, 60), tab: true };
    } finally { c.ws.close(); }
  }
  try {   // 탭 없음 → 브라우저 쿠키를 붙여 1회 GET (저장/전송 없는 읽기 전용)
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const bs = cdp(ver.webSocketDebuggerUrl);
    await bs.ready;
    const all = ((await bs.send('Storage.getCookies').catch(() => ({ cookies: [] }))).cookies || [])
      .filter((c) => /dpsnnn/.test(c.domain || ''));
    bs.ws.close();
    const html = await fetch(`${DPS.base}${DPS.page}`, {
      headers: { 'User-Agent': UA, Cookie: all.map((c) => `${c.name}=${c.value}`).join('; ') },
      signal: AbortSignal.timeout(12000),
    }).then((r) => r.text());
    const mi = (html.match(/class="[^"]*\bmember-info\b([^"]*)"/) || [])[1] || '';
    return {
      ...parseDpsLogin({
        guest: /로그인이\s*필요합니다/.test(html), guestClass: /guest/.test(mi) || /member-info[^"]*guest/.test(html),
        memberBlock: !!mi && !/guest/.test(mi), member: '', isGuestFlag: null,
        source: `HTTP + 브라우저 쿠키 ${all.length}개`,
      }),
      tab: false, cookies: all.length,
    };
  } catch (e) {
    return { ok: false, loggedIn: null, msg: 'CDP/HTTP 모두 실패: ' + String(e && e.message).slice(0, 70), tab: false };
  }
}

/** ── 결제(주문) 화면 스냅샷 ─────────────────────────────────────────────────
 *  /shop_payment/?order_code=… 화면. 필드 name/id 는 아임웹 설정에 따라 달라지므로
 *  "무엇을 어디에 넣었는지"까지 그대로 밖으로 내보낸다 (매핑 검증/사후 확인용). */
export function dpsOrderRead() {
  const txt = (e) => (e && (e.innerText || e.value) ? String(e.innerText || e.value).replace(/\s+/g, ' ').trim() : '');
  const labelOf = (e) => {
    if (e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) return txt(l); }
    const l = e.closest && e.closest('label'); if (l) return txt(l);
    const p = e.closest && e.closest('li,td,th,dt');
    return p ? txt(p).slice(0, 40) : '';
  };
  const all = Array.from(document.querySelectorAll('input,select,textarea'));
  const inputs = all.filter((e) => !/hidden|checkbox|radio|submit|button|image/i.test(e.type || '')).map((e) => ({
    key: [e.name, e.id].filter(Boolean).join('/'), type: e.type || e.tagName.toLowerCase(),
    label: labelOf(e), val: String(e.value || '').slice(0, 24),
  })).slice(0, 40);
  const radios = Array.from(document.querySelectorAll('input[type=radio]')).map((e) => ({
    key: [e.name, e.id].filter(Boolean).join('/'), label: labelOf(e), checked: !!e.checked,
  })).slice(0, 20);
  const f = document.querySelector('#booking_f');
  const btns = Array.from(document.querySelectorAll('a,button')).map((e) => txt(e))
    .filter((t) => t && t.length < 24 && /결제|주문|예약|확인|동의/.test(t)).slice(0, 12);
  const body = document.body ? document.body.innerText || '' : '';
  const F = window.__DPS_FILL;
  return {
    href: location.href.slice(0, 110), onPayment: /shop_payment|order/i.test(location.href),
    guest: /로그인이\s*필요합니다/.test(body) || !!document.querySelector('.member-info.guest'),
    bookingForm: !!f,
    hidden: f ? Array.from(f.querySelectorAll('input[type=hidden]')).reduce((a, e) => (a[e.name] = String(e.value || '').slice(0, 24), a), {}) : null,
    inputs, radios, buttons: btns,
    // 약관 체크박스 상태 — '결제하기' 게이트가 근거로 쓰고 로그에도 그대로 나온다 (이름이 없는 약관은 주변 텍스트로 노출)
    checks: Array.from(document.querySelectorAll('input[type=checkbox]')).map((e) => ({
      key: [e.name, e.id].filter(Boolean).join('/')
        || (e.closest && e.closest('li,label,p,td,dt,div') ? txt(e.closest('li,label,p,td,dt,div')).slice(0, 24) : '(체크박스)'),
      checked: !!e.checked,
    })).slice(0, 14),
    agreeLeft: (window.__DPS_FILL && window.__DPS_FILL.agree && window.__DPS_FILL.agree.left) || [],
    pay: (radios.find((r) => r.checked && /무통장|가상/.test(r.label)) || {}).label
      || (/무\s*통\s*장\s*입\s*금/.test(body) ? '화면에 무통장입금 있음 (선택 상태 미확인)' : ''),
    total: (body.replace(/\s+/g, ' ').match(/[0-9][0-9,]*\s*원/) || [''])[0],
    fillAt: F ? F.at : null, fillMs: F ? Math.round(F.ms) : null, filled: F ? F.filled : null,
    matched: F ? F.matched : null, missing: F ? F.missing : null, fillErr: window.__FILL_ERR || null,
    bank: (F && F.bank) || '', agreeState: (F && F.agree) || null,
  };
}

/**
 * 결제(주문) 화면 입력기 — **이름 / 연락처 / 입금자명**을 채우고 결제수단을 **무통장입금**으로 고른 뒤
 * **약관 전체동의(개별 약관 포함)까지** 체크한다. 최종 `결제하기` 는 여기서 누르지 않는다 → 별도 게이트 `dpsPay`.
 *
 * 아임웹은 필드 name/id 가 설정마다 달라서 3단으로 찾는다:
 *   ① 라벨/주변 텍스트 정규식  ② 알려진 name/id 후보  ③ 없으면 missing 으로 남긴다 (추측 입력 금지)
 * 판정 순서는 입금자 → 연락처 → 이름. '예약자명' 도 '자명' 을 포함하므로 입금자를 먼저 판단해야 오입력이 없다.
 * OPT.agreeAll:true → 약관 체크박스를 체크한다(기본 false — 러너가 판단해서 넘긴다). 광고/마케팅 수신은 절대 체크하지 않는다.
 */
export function dpsFiller(WANT, OPT) {
  const O = OPT || {};
  const AGREE_ALL = !!O.agreeAll;
  const t0 = performance.now();
  const S = { at: null, ms: 0, filled: {}, matched: {}, missing: [], pay: null, bank: null, agree: null, err: null };
  // 슬롯 페이지(/reserve_g) 등 결제화면이 아닌 문서에서 헛돌면(25초 rAF 루프) 안 된다: 결제화면일 때만 돈다.
  const looksPay = () => /shop_payment|order_code|\/order\b/i.test(location.href)
    || /무\s*통\s*장/.test(document.body ? document.body.innerText || '' : '');
  if (!looksPay()) { S.skipped = '결제화면이 아닙니다 (대기하지 않음)'; window.__DPS_FILL = S; return; }
  // 이전 실행 잔존 플래그(같은 문서에서 재호출/이전 입력기) 가 결과를 오염시키지 않게 먼저 지운다 (실측: 완료됐는데 err 이 남음)
  window.__FILL_ERR = null; window.__FILL_AT = null; window.__FILL_MS = null;
  // 실측 확정(2026-09-09, 주문 o2026… 결제화면): 라벨 텍스트가 비어 있고 name 으로만 구분된다.
  //   주문자명 orderer_name(text) · 연락처 orderer_call(tel) · 입금자명 depositor_name(text)
  //   결제수단 pay_type(radio, 값 card|cash — cash = 무통장입금) · 입금은행 cash_idx(select) · 요청사항 deliv_memo
  const CAND = {
    name: ['orderer_name', 'order_name', 'input_name', 'ord_name', 'buyer_name', 'res_name', 'name', 'username'],
    hp: ['orderer_call', 'orderer_hp', 'input_hp', 'order_hp', 'hp', 'mobile', 'phone', 'tel', 'contact'],
    dep: ['depositor_name', 'depositor', 'deposit_name', 'input_deposit_name', 'order_deposit_name', 'depositname', 'deposit', 'account_name'],
  };
  const SKIP = ['deliv_memo', 'order_code', 'imagepath', 'pg_type', 'pg_status', 'cash_idx', 'pay_type', 'coupon', 'point', 'mileage'];
  const RX = {
    dep: /입\s*금\s*자|보\s*낸\s*이|deposit|account\s*name/i,
    hp: /연\s*락\s*처|휴\s*대\s*폰|핸\s*드\s*폰|전\s*화|hp|mobile|phone|tel/i,
    name: /예\s*약\s*자|주\s*문\s*자|이\s*름|성\s*함|name/i,
  };
  const setV = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const labelOf = (e) => {
    if (e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) return (l.innerText || '').trim(); }
    const l = e.closest && e.closest('label'); if (l) return (l.innerText || '').trim();
    const p = e.closest && e.closest('li,td,th,dt');
    return p ? (p.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) : '';
  };
  const usable = () => Array.from(document.querySelectorAll('input,textarea')).filter((e) =>
    !/hidden|checkbox|radio|submit|button|image|password|file|date|number/i.test(e.type || '')
    && !e.disabled && !e.readOnly && e.offsetParent !== null);
  const classify = (e) => {
    const lb = labelOf(e), k = [e.name || '', e.id || ''].join(' ').toLowerCase();
    if (SKIP.some((s) => k.includes(s))) return '';   // 요청사항/결제 hidden/은행선택 등은 이 도구가 건드리지 않는다
    if (RX.dep.test(lb) || CAND.dep.some((c) => k.includes(c))) return 'dep';
    if (RX.hp.test(lb) || CAND.hp.some((c) => k.includes(c))) return 'hp';
    if (RX.name.test(lb) || CAND.name.some((c) => k.includes(c))) return 'name';
    return '';
  };
  const put = (el, v, kind) => {
    const s = String(v || '');
    if (!s) return false;
    if (String(el.value) !== s) setV(el, s);
    S.filled[kind] = s;
    S.matched[kind] = [el.name || '', el.id || '', labelOf(el).slice(0, 24)].filter(Boolean).join('/');
    return true;
  };
  const pickPay = () => {
    const isPay = (t) => /무\s*통\s*장\s*입\s*금|가\s*상\s*계\s*좌/.test(t);
    const r = Array.from(document.querySelectorAll('input[type=radio]'))
      .find((e) => isPay(labelOf(e) + ' ' + (e.value || '')));
    if (r) { if (!r.checked) r.click(); return 'radio:' + (r.name || r.id || ''); }
    const lb = Array.from(document.querySelectorAll('label,a,button,li')).find((e) => {
      const t = (e.innerText || '').replace(/\s+/g, '');
      return t.length < 16 && /무통장입금/.test(t);
    });
    if (lb) { lb.click(); return 'click:' + lb.tagName; }
    return '';
  };
  /** 약관성 체크박스 분류 — 실측에서 일부 약관은 name/id 없이 체크박스만 있었다 → 주변 텍스트로 함께 판단한다.
   *  전체동의는 아임웹에서 name=id=paymentAllCheck 로 노출된다(실측 확인). */
  const agreeBoxes = () => {
    const need = [], skipped = [];
    for (const e of Array.from(document.querySelectorAll('input[type=checkbox]'))) {
      if (e.disabled) continue;
      const k = [e.name || '', e.id || ''].join(' ').toLowerCase();
      const host = e.closest && e.closest('li,label,p,td,dt,div');
      const lb = (labelOf(e) + ' ' + (host ? host.innerText || '' : '')).replace(/\s+/g, ' ').trim();
      const isAgree = /agree|consent|paymentall|all[_-]?chk|chk[_-]?all|chk[_-]?agree/i.test(k)
        || /동의|약관|수집|이용|환불|취소|고지/.test(lb);
      if (!isAgree) continue;
      // 선택 수신(광고/마케팅 등) 은 전체동의와 무관하게 절대 대신 체크하지 않는다
      if (/광고|마케팅|이벤트|뉴스레터|행사\s*안내/.test(lb)) { skipped.push(e.name || e.id || lb.slice(0, 18)); continue; }
      need.push(e);
    }
    return { need, skipped };
  };
  const labelAll = (e) => {
    const host = e.closest && e.closest('li,label,p,td,dt,div');
    return [e.name || '', e.id || '', labelOf(e), host ? host.innerText || '' : ''].join(' ');
  };
  /** '전체동의/전체선택' 을 먼저 누른 뒤(사이트가 개별 체크까지 연동한다) 남은 개별 약관을 확인한다. */
  const doAgree = () => {
    const { need, skipped } = agreeBoxes();
    const all = need.find((e) => /paymentall|all[_-]?chk|chk[_-]?all|allagree/i.test([e.name || '', e.id || ''].join(' ')) || /전체\s*동의|전체\s*선택/.test(labelAll(e)));
    if (all && !all.checked) all.click();
    const left = [];
    for (const e of need) {
      if (e.checked) continue;
      e.click();
      if (!e.checked) left.push(e.name || e.id || '약관');   // 사이트가 즉시 되돌려 놓은 경우(별도 검증 요구 등)
    }
    S.agree = { total: need.length, checked: need.filter((e) => e.checked).length, left, skipped, all: all ? (all.name || all.id || '전체동의') : '' };
    return !left.length;
  };
  /** 입금계좌(select[name=cash_idx]) — 계좌가 **하나뿐**이면 선택해 준다(선택지가 하나인 것을 고른 것일 뿐 판단이 아니다).
   *  선택지가 여러 개면 사람이 고르게 두고 비워 둔다 (게이트가 '입금계좌 미선택' 으로 결제를 막는다). */
  const pickBank = () => {
    const s = document.querySelector('select[name=cash_idx]');
    if (!s) return '';
    const real = Array.from(s.options).filter((o) => o.value && o.value !== '0');
    if (s.value && s.value !== '0') return 'already';
    if (real.length === 1) { setV(s, real[0].value); return 'auto:' + real.length; }
    return real.length > 1 ? 'multi' : 'none';
  };
  const tick = () => {
    const by = { name: [], hp: [], dep: [] };
    for (const e of usable()) { const k = classify(e); if (k) by[k].push(e); }
    S.missing = [];
    if (WANT.dep) { if (!by.dep.length) S.missing.push('입금자명'); else put(by.dep[0], WANT.dep, 'dep'); }
    if (WANT.hp) {
      const dig = String(WANT.hp).replace(/[^0-9]/g, '');
      if (!by.hp.length) S.missing.push('연락처');
      else if (by.hp.length >= 3) {          // 010 / 1234 / 5678 조각 입력란
        [dig.slice(0, 3), dig.slice(3, 7), dig.slice(7)].forEach((v, i) => put(by.hp[i], v, 'hp' + (i + 1)));
        S.filled.hp = WANT.hp; S.matched.hp = '조각 3개';
      } else put(by.hp[0], WANT.hp, 'hp');
    }
    if (WANT.name) { if (!by.name.length) S.missing.push('이름'); else put(by.name[0], WANT.name, 'name'); }
    if (!S.pay) S.pay = pickPay();
    if (!S.pay) S.missing.push('무통장입금');
    if (!S.bank) S.bank = pickBank();
    // 약관: 자동 체크(OPT.agreeAll) 일 때는 클릭하고, 아닐 때는 상태만 밖에 노출한다(결제 게이트의 거부 근거로 쓰인다)
    let agreeOk = true;
    if (AGREE_ALL) agreeOk = doAgree();
    else {
      const a = agreeBoxes();
      S.agree = { total: a.need.length, checked: a.need.filter((e) => e.checked).length, left: a.need.filter((e) => !e.checked).map((e) => e.name || e.id || '약관'), skipped: a.skipped, all: '' };
      agreeOk = true;   // 자동 체크가 꺼져 있을 때 약관 미체크는 채움 완료를 막지 않는다 — '결제하기' 게이트가 클릭 시점에 따로 본다
    }
    window.__DPS_FILL = S;
    const need = ['name', 'hp', 'dep'].filter((k) => WANT[k] && !S.filled[k]);
    if (!need.length && S.pay && agreeOk) {
      S.ms = performance.now() - t0; S.at = Date.now();
      window.__FILL_AT = S.at; window.__FILL_MS = S.ms; return;
    }
    if (performance.now() - t0 > 25000) {
      // 필드는 채워졌는데 약관만 안 되는 경우와, 필드 자체가 없는 경우를 구분한다 (전자는 결제 게이트가 따로 막는다)
      const fieldMiss = need.length || !S.pay;
      S.err = fieldMiss ? '찾지 못함: ' + S.missing.join(', ') : '약관 체크 실패: ' + ((S.agree && S.agree.left) || []).join(', ');
      window.__FILL_ERR = fieldMiss
        ? '결제화면에서 ' + S.missing.join(', ') + ' 필드를 찾지 못했습니다'
        : '약관 체크박스가 체크된 상태로 유지되지 않습니다: ' + ((S.agree && S.agree.left) || []).join(', ');
      if (!fieldMiss) { S.at = Date.now(); window.__FILL_AT = S.at; }   // 입력은 끝난 상태 — 결제 게이트가 약관 미체크로 거부한다
      return;
    }
    // 배경 탭에서는 requestAnimationFrame 이 멈춰 채움이 1차 시도시도 끝나지 않는다(실측: at=미완료, missing 잔존)
    // → 화면이 안 보이면 타이머로 재시도한다(백그 스로틀링이 걸려도 rAF 처럼 완전히 멈추지는 않는다).
    if (document.hidden) setTimeout(tick, 120); else requestAnimationFrame(tick);
  };
  tick();
}

/** 슬롯 페이지(/reserve_g?idx=…&day=…) 스냅샷 — #booking_f 의 예약좌표와 버튼/가격/로그인 상태 */
export function dpsSlotRead() {
  const txt = (e) => (e && e.innerText ? e.innerText.replace(/\s+/g, ' ').trim() : '');
  const f = document.querySelector('#booking_f');
  const body = document.body ? document.body.innerText || '' : '';
  const vis = (e) => e && e.offsetParent !== null;
  const btn = Array.from(document.querySelectorAll('.fixed_btn a, .fixed_btn button, .buy_btns a, a.buy'))
    .filter((e) => vis(e) && /^예\s*약\s*하\s*기$/.test(txt(e)));
  const hidden = f ? Array.from(f.querySelectorAll('input[type=hidden]')).reduce((a, e) => (a[e.name] = String(e.value || '').slice(0, 24), a), {}) : null;
  return {
    href: location.href.slice(0, 110), onSlot: /reserve_/.test(location.pathname),
    title: (document.title || '').slice(0, 40), bookingForm: !!f, hidden,
    price: (body.replace(/\s+/g, ' ').match(/[0-9][0-9,]*\s*원/) || [''])[0],
    buttons: btn.length, btnText: btn.length ? txt(btn[0]) : '',
    guest: /로그인이\s*필요합니다/.test(body) || !!document.querySelector('.member-info.guest'),
  };
}

/**
 * '예약하기' 클릭 — addBooking() 을 태우는 동작이라 주문이 만들어진다. 따라서 opt-in 이고 아래를 모두 통과해야 한다.
 *   · #booking_f 가 있고 hidden 예약좌표(prod_idx / start_day)가 목표와 일치
 *   · 로그인되어 있고 (로그아웃이면 openLogin 창만 뜨고 흐지부지된다)
 *   · 화면에 보이는 '예약하기' 가 정확히 1개 (모바일 복제 버튼은 visibility 로 걸러진다)
 *   · 이 세션에서 이미 누른 적이 없다 (중복 주문 방지 — 실패해도 재클릭 하지 않는다)
 * preview:true 이면 아무것도 누르지 않고 판단 근거만 돌려준다.
 */
export function dpsBook(opt) {
  const txt = (e) => (e && e.innerText ? e.innerText.replace(/\\s+/g, ' ').trim() : '');
  const vis = (e) => e && e.offsetParent !== null;
  const f = document.querySelector('#booking_f');
  const body = document.body ? document.body.innerText || '' : '';
  const hidden = f ? Array.from(f.querySelectorAll('input[type=hidden]')).reduce((a, e) => (a[e.name] = String(e.value || '').slice(0, 24), a), {}) : {};
  const btn = Array.from(document.querySelectorAll('.fixed_btn a, .fixed_btn button, .buy_btns a, a.buy, button'))
    .filter((e) => vis(e) && /^예\s*약\s*하\s*기$/.test(txt(e)));
  const problems = [];
  if (!f) problems.push('#booking_f 없음(슬롯 페이지가 아님)');
  else {
    // hidden 은 달력 JS 가 조금 뒤에 채우는 경우가 있다 → 값이 없으면 '미채움'으로 막고(추측 통과 금지), 있으면 비교한다
    const have = String(hidden.start_day || '').replace(/-/g, '');
    if (opt.want.idx && String(hidden.prod_idx) !== String(opt.want.idx)) problems.push(`prod_idx ${hidden.prod_idx}≠${opt.want.idx}`);
    if (opt.want.day && !have) problems.push('start_day 아직 미채움');
    else if (opt.want.day && have !== String(opt.want.day).replace(/-/g, '')) problems.push(`start_day ${hidden.start_day}≠${opt.want.day}`);
  }
  if (/로그인이\s*필요합니다/.test(body) || document.querySelector('.member-info.guest')) problems.push('로그아웃 상태');
  if (btn.length !== 1) problems.push(`'예약하기' ${btn.length}개`);
  if (window.__DPS_BOOKED) problems.push('이미 클릭한 주문입니다');
  const out = {
    ok: false, btn: btn.length ? txt(btn[0]) : '', prod: hidden.prod_idx || '', day: hidden.start_day || '',
    end: hidden.end_day || '', price: (body.replace(/\s+/g, ' ').match(/[0-9][0-9,]*\s*원/) || [''])[0],
    payHint: /무통장/.test(body) ? '화면에 무통장 문구 있음' : '', problems,
  };
  if (opt.preview || problems.length) return out;
  window.__DPS_BOOKED = Date.now();
  btn[0].click();
  out.ok = true; out.clickedAt = window.__DPS_BOOKED; out.why = '클릭 완료';
  return out;
}

/**
 * '결제하기' 클릭 — 돈이 나가는 최종 동작이므로 **기본 off**(UI 체크박스 / --pay-submit 로만 켜진다) 이고,
 * 아래를 **모두** 통과해야만 누른다. 하나라도 걸리면 클릭하지 않고 이유를 돌려준다.
 *   · 결제화면(/shop_payment/?order_code=) 일 것 — 슬롯/주문목록 페이지에서 헛클릭 금지
 *   · 화면에 보이는 '무통장입금' 화면일 것 (카드 결제 화면에서 같은 버튼을 누르면 카드 결제가 진행된다)
 *   · 입력기가 이름/연락처/입금자명을 끝까지 채웠고(`__DPS_FILL.at`), 화면의 값이 실제로 비어 있지 않을 것
 *   · 결제수단 라디오가 무통장입금(pay_type=cash) 으로 선택되어 있고, 입금계좌(`cash_idx`)가 정해져 있을 것
 *     (계좌가 하나뿐이면 입력기가 골라 둔다 — 선택지가 여러 개인데 비어 있으면 사람이 고르게 한다)
 *   · 약관 체크박스(전체동의 포함) 가 전부 체크되어 있을 것 — 이 도구가 체크한 뒤에도 사이트가 되돌려 놓으면 거부
 *   · 결제예상금액이 읽힐 것(0 원 금지), 목표 금액을 넘겼으면 그 값과 일치할 것
 *   · 보이는 '결제하기' 가 정확히 1개, 이미 결제완료/취소 문구가 없을 것, 이 세션에서 이미 누른 적이 없을 것
 */
export function dpsPay(opt) {
  const o = opt || {};
  const txt = (e) => (e && (e.innerText || e.value) ? String(e.innerText || e.value).replace(/\s+/g, ' ').trim() : '');
  const vis = (e) => e && e.offsetParent !== null;
  const body = document.body ? document.body.innerText || '' : '';
  const F = window.__DPS_FILL || null;
  const hostOf = (e) => (e.closest && e.closest('li,label,p,td,dt,div')) || null;
  const labelAll = (e) => {
    const l = e.id ? document.querySelector('label[for="' + e.id + '"]') : null;
    const h = hostOf(e);
    return [e.name || '', e.id || '', l ? l.innerText || '' : '', h ? h.innerText || '' : ''].join(' ');
  };
  // 입력기가 채운 약관 판정과 같은 기준 (이 함수는 따로 직렬화되므로 로직을 다시 담은 것이다 — 기준은 dpsFiller 와 동일해야 한다)
  const agreeBoxes = () => Array.from(document.querySelectorAll('input[type=checkbox]')).filter((e) => {
    const k = [e.name || '', e.id || ''].join(' ').toLowerCase();
    const lb = labelAll(e).replace(/\s+/g, ' ');
    if (/광고|마케팅|이벤트|뉴스레터|행사\s*안내/.test(lb)) return false;   // 선택 수신은 게이트 근거에서도 뺀다
    return /agree|consent|paymentall|all[_-]?chk|chk[_-]?all|chk[_-]?agree/i.test(k) || /동의|약관|수집|이용|환불|취소|고지/.test(lb);
  });
  const boxes = agreeBoxes();
  const unchecked = boxes.filter((e) => !e.checked).map((e) => e.name || e.id || txt(hostOf(e)) || '약관');
  const btn = Array.from(document.querySelectorAll('a,button,input[type=submit],input[type=button]'))
    .filter((e) => vis(e) && /^(결제하기|주문하기|결제진행)$/.test(txt(e).replace(/\s+/g, '')));
  const cash = document.querySelector('input[name=pay_type][value=cash]');
  const total = (body.replace(/\s+/g, ' ').match(/([0-9][0-9,]*)\s*원/) || [])[1] || '';
  const totalNum = Number(String(total).replace(/[^0-9]/g, '')) || 0;
  const problems = [];
  if (!/shop_payment|order_code/i.test(location.href)) problems.push('결제화면이 아닙니다');
  if (/결제\s*완료|주문\s*완료|입금\s*확인|결제가\s*취소|취소\s*완료/.test(body)) problems.push('이미 결제/취소된 화면');
  if (!/무\s*통\s*장/.test(body)) problems.push('무통장입금 화면이 아님(카드 결제 화면일 수 있음)');
  if (!F || !F.at) problems.push('입력기 완료 전');
  if (F && (F.missing || []).length) problems.push('누락 필드: ' + F.missing.join(','));
  for (const pair of [['orderer_name', '주문자명'], ['orderer_call', '연락처'], ['depositor_name', '입금자명']]) {
    const e = document.querySelector('[name=' + pair[0] + ']');
    if (e && !String(e.value || '').trim()) problems.push(pair[1] + ' 비어 있음');
  }
  if (cash && !cash.checked) problems.push('무통장입금 미선택');
  // 입금계좌: 선택지가 하나뿐이면 입력기가 이미 골라 뒀다. 여러 개인데 미선택이면 사람이 고르게 한다.
  const bankSel = document.querySelector('select[name=cash_idx]');
  if (bankSel && cash && cash.checked) {
    const real = Array.from(bankSel.options).filter((o) => o.value && o.value !== '0');
    if ((!bankSel.value || bankSel.value === '0') && real.length !== 1) problems.push('입금계좌 미선택');
  }
  if (unchecked.length) problems.push('약관 미체크: ' + unchecked.join(','));
  if (!totalNum) problems.push('결제예상금액 없음');
  const want = Number(String(o.wantTotal || '').replace(/[^0-9]/g, '')) || 0;
  if (want && totalNum && want !== totalNum) problems.push(`금액 ${totalNum} ≠ 목표 ${want}`);
  if (btn.length !== 1) problems.push(`'결제하기' ${btn.length}개`);
  if (window.__DPS_PAID) problems.push('이미 클릭한 결제입니다');
  const out = {
    ok: false, href: location.href.slice(0, 110), btn: btn.length ? txt(btn[0]) : '', total: total || '-',
    pay: cash ? (cash.checked ? '무통장입금' : '신용카드 등 다른 수단') : '-', boxes: boxes.length, unchecked, problems,
  };
  if (o.preview || problems.length) return out;
  window.__DPS_PAID = Date.now();
  btn[0].click();
  out.ok = true; out.clickedAt = window.__DPS_PAID; out.why = '클릭 완료';
  return out;
}




