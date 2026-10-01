/**
 * 방탈출 토끼굴(rabbitholeescape.co.kr) 사이트 어댑터
 *
 * 호스팅: 자체 Laravel 사이트. 예약 화면 한 장에서 지점/테마/날짜를 고르고 시간을 누르면
 * 신청서로 넘어가는 구조다. 실측 (2026-10-01, 비로그인):
 *   · 예약 화면  GET /reservation?branch=1&theme=&date=YYYY-MM-DD → HTML 한 장
 *       지점  <select name="branch"> → 1 = 홍대점 (지점 1개)
 *       테마  <select name="theme">  → '' = 전체, 5 = 행운만물상, 4 = 두껍아 두껍아 헌집줄게 새집다오
 *       날짜  <input name="date" value="2026-10-01">  ← 서버 기준일이 이 값으로 온다
 *             datepicker 는 minDate=today, maxDate=today+7 (js/reservation.js 실측) → D-7 롤링 창
 *             창 밖 날짜로 조회하면 서버가 **302 로 홈(/) 으로 돌려보낸다** (실측 10/1 조회 시 10/8 → 302)
 *       테마별 정보  <section class="res-item"><h2>테마명</h2><table><th>장르</th><td>…</td> …
 *                    인원 "2~4" / 시간 "70min" / 난이도 <div class="res-item-step size4">
 *       슬롯  <ul class="res-times"><li><div class="res-times-btn"><button class="active1 eveReservationButton">
 *                 <label>예약가능</label><span>11:20</span>
 *                 <div class="dn eveHiddenData">{"branch":1,"theme":5,"date":"2026-10-07","time":"11:20"}</div>
 *             </button></div></li></ul>
 *             가능 = class 에 active1 + label '예약가능' + hiddenData 있음 / 불가 = class 없음 + '예약불가'
 *   · 슬롯 클릭  사이트 JS(js/reservation.js) 가 #eveSubmitForm hidden(branch/theme/date/time/_token) 을
 *             hiddenData JSON 으로 채우고 **submit** → POST /reservation/create (신청서가 렌더된다)
 *   · 신청서    form POST /reservation/create — hidden 으로 예약좌표 재전송 + 입력란
 *             name(maxlength 10) / phone(mask '00Z-000Z-0000', maxlength 13) / people select(테마별 2·3·4) /
 *             payment_method radio(실측 1종: value 21 = 가상계좌) / policy checkbox(주의사항·개인정보 동의) /
 *             요금표 <div id="hiddenData">{"2":48000,"3":72000,"4":96000}</div>
 *   · 제출      #eveReservationBtn → 사이트 검증(alert) → AJAX POST /reservation/payment → /reservation/done
 *             즉 **이 버튼이 곧 예약 생성 + 가상계좌 발급(입금 의무)** 이다.
 *   · 오픈 규칙 공지가 없다. 달력이 오늘부터 +7일까지만 허용하는 롤링 창이고 서버는 창 밖 날짜를 홈으로 보낸다.
 *   · devtools-detector 류 디버거 차단은 없다 (vendor/common/reservation*.js 에 없음 → 해제를 걸지 않는다)
 *
 * 정책: 신청서(이름/연락처/인원/결제수단/약관) 까지는 자동으로 채운다.
 *       그러나 '예약하기' 는 예약 생성 + 가상계좌 발급을 동시에 일으키므로 **절대 대신 누르지 않는다**
 *       (단편선의 최종 '결제하기' 와 같은 격 — 사람이 화면에서 확인하고 누른다).
 */

export const RHE = {
  base: 'https://www.rabbitholeescape.co.kr',
  page: '/reservation',
  create: '/reservation/create',
  done: '/reservation/done',
  label: '방탈출 토끼굴(홍대)',
  branch: 1,
  branches: [[1, '홍대점']],
  leadDays: 7,        // js/reservation.js datepicker maxDate = 오늘 + 7 (실측)
  openTime: '00:00',  // 사이트에 오픈 시각 공지가 없다 → 달력 창이 밀리는 시각을 자정으로 본다(관측값이 우선)
  payMethod: '가상계좌',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const DAY_MS = 86400000;
const strip = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** KST 벽시계 오늘 (사이트 달력은 KST) */
export const rheToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export const rheUrl = ({ branch = RHE.branch, theme = '', date = '' } = {}) =>
  `${RHE.base}${RHE.page}?branch=${encodeURIComponent(branch)}&theme=${encodeURIComponent(theme || '')}${date ? `&date=${encodeURIComponent(date)}` : ''}`;

/** 예약 화면인지 구분한다 (홈/오류 페이지와 헷갈리면 '창 밖' 판단이 깨진다) */
export const isRhePage = (html) => {
  const h = String(html || '');
  return h.includes('eveSubmitForm') || (h.includes('res-times') && /name="branch"/.test(h));
};


/* ---------------- 세션 쿠키가 있는 GET ----------------
 * 실측: 쿠키 없이 /reservation?date=… 를 처음 때리면 홈으로 리다이렉트된다.
 * 쿠키(XSRF-TOKEN / session) 를 먼저 받아 두고 같은 세션으로 물으면 결과를 준다. */
let JAR = '';
const keepCookies = (res) => {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const kv = String(c).split(';')[0];
    if (kv && !JAR.split('; ').includes(kv.split('=')[0] + '=')) JAR = JAR ? `${JAR}; ${kv}` : kv;
  }
};

async function rheFetch(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9', ...(JAR ? { cookie: JAR } : {}), ...(referer ? { Referer: referer } : {}),
    },
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  keepCookies(res);
  if (res.status >= 300 && res.status < 400) return { status: res.status, redirected: true, html: '', loc: res.headers.get('location') || '' };
  return { status: res.status, redirected: false, html: await res.text() };
}

/**
 * 예약 화면 HTML. 첫 요청이 세션 없이 튕기면(실측) 쿠키를 받고 한 번 더 물는다.
 * 창 밖 날짜는 끝까지 홈으로 돌아가므로 빈 문자열을 돌려준다 → 호출자가 '아직 오픈 전' 으로 안다.
 */
export async function rheHtml(opt = {}) {
  const url = rheUrl(opt);
  const first = await rheFetch(url);
  if (!first.redirected && first.status === 200 && isRhePage(first.html)) return first.html;
  const warm = await rheFetch(`${RHE.base}${RHE.page}`, `${RHE.base}/`);
  if (!isRhePage(warm.html)) return isRhePage(first.html) ? first.html : '';
  const again = await rheFetch(url, `${RHE.base}${RHE.page}`);
  return again.redirected || again.status !== 200 ? '' : again.html;
}

/** select[name=…] 의 옵션 목록 */
export function rheOptions(html, name) {
  const m = new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?<\\/select>`).exec(String(html || ''));
  if (!m) return [];
  return [...m[0].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((o) => ({ value: o[1], label: strip(o[2]) }));
}

/** 예약 화면 전체 → { today, branches, themes, sections:[{name, info, slots}] } */
export function parseRhePage(html) {
  const h = String(html || '');
  const out = {
    today: (h.match(/name="date"[^>]*value="(\d{4}-\d{2}-\d{2})"/) || [])[1] || null,
    branches: rheOptions(h, 'branch').filter((o) => o.value),
    themes: rheOptions(h, 'theme').filter((o) => o.value),
    sections: [],
  };
  for (const sec of h.split(/<section[^>]*class="res-item"/).slice(1)) {
    const name = strip((sec.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1]);
    const info = {};
    for (const row of sec.matchAll(/<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)) info[strip(row[1])] = strip(row[2]);
    // 난이도는 텍스트가 아니라 <div class="res-item-step size4"> 의 눈금 개수로 표시된다 → 클래스 값으로 읽는다
    const level = (sec.match(/res-item-step\s+size(\d+)/) || [])[1] || '';
    const slots = [];
    for (const b of sec.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
      const time = ((b[2].match(/<span>\s*(\d{1,2}:\d{2})\s*<\/span>/) || [])[1] || '');
      if (!time) continue;
      const cls = (/class="([^"]*)"/.exec(b[1]) || [])[1] || '';
      const label = strip((b[2].match(/<label>([\s\S]*?)<\/label>/) || [])[1]);
      const raw = (b[2].match(/class="[^"]*eveHiddenData[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '';
      let data = null;
      try { data = raw ? JSON.parse(decode(raw)) : null; } catch { data = null; }
      slots.push({ time, label, cls: cls.trim(), data, open: /active1/.test(cls) && /예약\s*가능/.test(label) && !!data });
    }
    out.sections.push({ name, info, level, slots });
  }
  return out;
}

/** 테마 목록(UI 드롭다운 재료). 화면의 테마 표에서 장르/인원/러닝타임까지 얇게 읽는다. */
export async function rheThemes(branch = RHE.branch, force = false) {
  if (!force && rheThemes._cache && Date.now() - rheThemes._cache.at < 1800000) return rheThemes._cache.r;
  let html = '';
  try { html = await rheHtml({ branch }); } catch { html = ''; }
  if (!isRhePage(html)) return { ok: false, themes: [], msg: '예약 화면을 읽지 못했습니다 (네트워크 확인)' };
  const p = parseRhePage(html);
  const themes = p.themes.map((t) => {
    const sec = p.sections.find((s) => s.name === t.label) || { info: {}, level: '' };
    const people = String(sec.info['인원'] || '').match(/(\d+)\s*[~\-]\s*(\d+)/);
    return {
      theme: Number(t.value), info: Number(t.value), name: t.label,
      genre: sec.info['장르'] || '', play: String(sec.info['시간'] || '').replace(/min/i, '').trim(),
      level: sec.level || '',
      personRange: people ? people[0] : '', minPerson: people ? Number(people[1]) : null,
      maxPerson: people ? Number(people[2]) : null, doing: '', notice: '',
    };
  });
  const r = { ok: themes.length > 0, themes, msg: themes.length ? '' : '테마 목록이 비어 있습니다' };
  if (themes.length) rheThemes._cache = { at: Date.now(), r };
  return r;
}

/** 그 날짜의 시간대 → 런너가 쓰는 공통 모양 { ok, slots:[{num,time,open,…}], notOpen } */
export async function rheTimes({ branch = RHE.branch, theme = '', date = rheToday() } = {}) {
  let html = '';
  try { html = await rheHtml({ branch, theme, date }); } catch (e) {
    return { ok: false, msg: String((e && e.message) || e).slice(0, 90), slots: [], date };
  }
  if (!isRhePage(html)) {
    return {
      ok: true, date, slots: [], open: 0, total: 0, notOpen: true,
      msg: '예약 창 밖 — 서버가 예약 화면으로 되돌립니다 (이 사이트는 오늘부터 +7일까지만 조회되는 롤링 창)',
    };
  }
  const p = parseRhePage(html);
  const want = (theme === '' || theme == null) ? null : String(theme);
  const wantName = want ? ((p.themes.find((t) => String(t.value) === want) || {}).label || '') : '';
  const slots = [];
  for (const s of p.sections) {
    // '예약불가' 버튼에는 hiddenData 가 없다 → 테마 번호는 섹션(제목 or 데이터) 에서 확정한다
    const byLabel = (p.themes.find((t) => t.label === s.name) || {}).value;
    const byData = (s.slots.find((x) => x.data) || { data: {} }).data.theme;
    const secTheme = Number(byData || byLabel || 0);
    const rows = !want ? s.slots
      : (String(secTheme) === want || (wantName && s.name === wantName)) ? s.slots
        : s.slots.filter((x) => x.data && String(x.data.theme) === want);
    if (!rows.length) continue;
    for (const x of rows) {
      const themeNum = Number((x.data && x.data.theme) || secTheme || want || 0);
      slots.push({
        num: themeNum, theme: themeNum, name: s.name, time: x.time, open: x.open, label: x.label,
        branch: (x.data || {}).branch, slotDate: (x.data || {}).date, slotTime: (x.data || {}).time,
      });
    }
  }
  slots.sort((a, b) => a.time.localeCompare(b.time) || a.theme - b.theme);
  const today = p.today || rheToday();
  return {
    ok: true, date, serverToday: p.today, branch: Number((p.branches[0] || {}).value || branch),
    slots, open: slots.filter((s) => s.open).length, total: slots.length,
    notOpen: false, past: !!date && date < today,
    msg: slots.length ? '' : '이 날짜에 시간표가 없습니다',
  };
}

/** matrix(날짜표) 를 훑은 결과를 기억해 '실제로 조회되는 창 끝' 을 openInfo 가 쓰게 한다 (lib.mjs noteWindow 와 같은 발상) */
const WINDOW = { at: 0, today: '', end: null };
export function rheNoteWindow(today, rows) {
  if (!Array.isArray(rows) || !today || !rows.length) return null;
  if (rows[rows.length - 1].total > 0) return null;      // 표 끝까지 창 안이면 창을 단정할 수 없다
  let last = -1;
  rows.forEach((r, i) => { if (r.total > 0) last = i; });
  if (last < 0) return null;
  WINDOW.at = Date.now(); WINDOW.today = today; WINDOW.end = rows[last].date;
  return { today, windowEnd: rows[last].date, leadDays: last };
}

/** 그 날짜가 예약으로 열리는 시각 (공지 없음 → 달력 창 기준, 관측된 창 끝이 있으면 그것 우선) */
export async function rheOpenInfo({ branch = RHE.branch, date = '' } = {}) {
  const today = rheToday();
  const observed = (WINDOW.end && WINDOW.today === today && Date.now() - WINDOW.at < 3600000) ? WINDOW.end : null;
  const base = {
    site: 'rhe', branch: (RHE.branches.find((b) => String(b[0]) === String(branch)) || [branch, '홍대점'])[1],
    openTime: RHE.openTime,
    openTimeSource: '사이트에 오픈 시각 공지 없음 — 달력 창(D-7)이 밀리는 시각을 00:00 으로 가정',
    leadDays: RHE.leadDays, leadSource: `js/reservation.js datepicker maxDate = 오늘+${RHE.leadDays} (실측)`,
    today, date: date || null, windowEnd: observed,
  };
  if (!date) return { ok: false, ...base, note: '날짜 미선택' };
  const shift = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS);
  if (shift < 0) return { ok: false, ...base, note: '지난 날짜입니다', past: true };
  const lead = observed ? Math.round((Date.parse(observed + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS) : RHE.leadDays;
  const openDate = new Date(Date.parse(today + 'T00:00:00Z') + (shift - lead) * DAY_MS).toISOString().slice(0, 10);
  const openAt = `${openDate}T${RHE.openTime}:00+09:00`;
  return {
    ok: true, ...base, leadDays: lead, openDate, openAt,
    msUntil: Date.parse(openAt) - Date.now(), past: Date.parse(openAt) < Date.now(),
    leadSource: observed
      ? `달력 관측 창 끝 ${observed} (오늘 +${lead}일) — 창 밖 날짜는 서버가 홈으로 되돌림`
      : base.leadSource,
    inWindow: shift <= lead,
    note: shift > lead
      ? '창 밖 날짜입니다 — 위 시각에 조회되기 시작합니다 (이 사이트는 오픈 시각 공지가 없어 자정으로 가정했습니다)'
      : '이미 조회되는 창 안의 날짜입니다 — 지금 ' + RHE.payMethod + ' 잔여석이 있는지가 관건입니다',
  };
}


/* ================= 브라우저 측 (CDP 로 문자열화해 주입/실행) =================
 * 토끼굴에는 devtools 차단이 없으므로 ext/inject.js 류 해제 없이 그대로 붙는다.          */

/** 예약 화면 스냅샷 — 시간 버튼과 각 버튼이 품고 있는 예약좌표(hiddenData) */
export function rheSlotRead() {
  const vis = (e) => !!e && e.offsetParent !== null;
  const rows = [];
  for (const b of document.querySelectorAll('.eveReservationButton')) {
    let data = null;
    try { data = JSON.parse((b.querySelector('.eveHiddenData') || {}).textContent || 'null'); } catch { data = null; }
    rows.push({
      time: ((b.querySelector('span') || {}).textContent || '').trim(),
      label: ((b.querySelector('label') || {}).textContent || '').trim(),
      active: /active1/.test(b.className), visible: vis(b), data,
    });
  }
  const theme = (document.querySelector('select[name="theme"]') || {}).value;
  return {
    href: location.href.slice(0, 110),
    onReservation: /^\/reservation\/?$/.test(location.pathname),
    dateInput: (document.querySelector('input[name="date"]') || {}).value || '',
    themeInput: theme === undefined ? '' : String(theme),
    buttons: rows.length,
    open: rows.filter((r) => r.active && r.data).length,
    times: rows.map((r) => r.time).slice(0, 20),
  };
}

/**
 * 시간 버튼 클릭 — 사이트(js/reservation.js) 가 .eveReservationButton 핸들러에서 #eveSubmitForm 의
 * hidden(branch/theme/date/time/_token) 을 hiddenData 로 채우고 submit 한다. 즉 이 클릭은 신청서로
 * 넘어가는 동작이므로 아래를 **모두** 통과해야만 누르고, preview:true 이면 판단 근거만 돌려준다.
 *   · /reservation 화면일 것 (신청서·완료·취소확인 화면에서는 헛클릭 위험)
 *   · hiddenData 좌표가 목표 4개(branch/theme/date/time) 와 정확히 일치할 것
 *   · 그 버튼이 정확히 1개이고 active1 + 라벨 '예약가능' 일 것 ('예약불가' 는 눌러도 아무 일도 없다)
 *   · #eveSubmitForm 과 _token 이 있을 것 — 사이트 자체 제출 경로를 쓴다(우리가 POST 를 조작하지 않는다)
 *   · 이 문서에서 이미 누른 적이 없을 것 (실패해도 재클릭 하지 않는다)
 */
export function rhePick(opt) {
  const o = opt || {};
  const vis = (e) => !!e && e.offsetParent !== null;
  const coord = (b) => {
    try { return JSON.parse((b.querySelector('.eveHiddenData') || {}).textContent || ''); } catch { return null; }
  };
  const same = (d) => !!d && String(d.branch) === String(o.branch) && String(d.theme) === String(o.theme)
    && String(d.date) === String(o.date) && String(d.time) === String(o.time);
  const all = Array.from(document.querySelectorAll('.eveReservationButton')).filter(vis);
  const hit = all.filter((b) => same(coord(b)));
  const form = document.querySelector('#eveSubmitForm');
  const problems = [];
  if (!/^\/reservation\/?$/.test(location.pathname)) problems.push('예약 화면이 아님: ' + location.pathname);
  if (!all.length) problems.push('예약가능 버튼(eveReservationButton) 0개');
  if (hit.length !== 1) problems.push('목표 시간 버튼 ' + hit.length + '개');
  if (hit.length === 1) {
    if (!/active1/.test(hit[0].className)) problems.push('active1 아님(사이트가 불가로 그림)');
    if (!/예약\s*가능/.test(hit[0].innerText || '')) problems.push("라벨이 '예약가능' 아님");
  }
  if (!form) problems.push('#eveSubmitForm 없음');
  else if (!(((form.querySelector('[name="_token"]') || {}).value) || '')) problems.push('_token 비어있음');
  const dateInput = (document.querySelector('input[name="date"]') || {}).value || '';
  if (dateInput && o.date && dateInput !== String(o.date)) problems.push('화면 날짜 ' + dateInput + '≠' + o.date);
  if (window.__RHE_PICKED) problems.push('이미 클릭한 회차입니다');
  const btn = hit[0];
  const label = btn ? ((((btn.querySelector('label') || {}).textContent) || '').trim() + ' ' + (((btn.querySelector('span') || {}).textContent) || '').trim()) : '';
  const out = {
    ok: false, btn: label.trim(), 화면: location.pathname,
    좌표: [o.branch, o.theme, o.date, o.time].join('/'),
    예약가능: all.filter((b) => /active1/.test(b.className)).length, problems,
  };
  if (o.preview || problems.length) return out;
  window.__RHE_PICKED = Date.now();
  btn.click();                       // 사이트 submit 경로 그대로 (form 을 우리가 조작하지 않는다)
  out.ok = true; out.clickedAt = window.__RHE_PICKED; out.why = '시간 버튼 클릭 완료 → 신청서 이동';
  return out;
}

/**
 * 신청서(/reservation/create) 입력기 — 문서가 열리자마자 폼을 찾아 이름/연락처/인원/결제수단/약관을 채운다.
 * **최종 '예약하기'(#eveReservationBtn) 는 건드리지 않는다** — 그 버튼이 예약 생성 + 가상계좌 발급이기 때문이다.
 * 배경 탭에서 requestAnimationFrame 이 멈추는 문제가 있어 setTimeout 으로 대기한다(기존 사이트들과 같은 처방).
 */
export function rheFiller(WANT) {
  const t0 = performance.now();
  const want = WANT || {};
  const setV = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, String(v)); else el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tick = () => {
    if (!/\/reservation\/create/.test(location.pathname)) {
      window.__RHE_FILL = { at: null, state: 'not-create-page', href: location.pathname };   // 아직 예약 화면 — 신청서는 새 문서로 뜬다
      return;
    }
    const nameEl = document.querySelector('form[action$="/reservation/create"] [name="name"]') || document.querySelector('input[name="name"]');
    const form = nameEl ? nameEl.form : null;
    if (!form || !nameEl) {
      if (performance.now() - t0 > 20000) { window.__RHE_FILL = { at: Date.now(), state: 'err', err: '신청서 폼을 찾지 못함' }; return; }
      setTimeout(tick, 60); return;
    }
    const phoneEl = form.querySelector('[name="phone"]');
    const peopleEl = form.querySelector('[name="people"]');
    const policyEl = form.querySelector('[name="policy"]');
    const pays = Array.prototype.slice.call(form.querySelectorAll('[name="payment_method"]'));
    const filled = {}; const missing = [];
    if (want.name && nameEl.value !== String(want.name)) setV(nameEl, want.name);
    if (nameEl.value) filled.name = 1; else missing.push('name');
    if (want.phone && phoneEl) setV(phoneEl, String(want.phone).replace(/[^0-9]/g, '').replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3'));
    if (phoneEl && phoneEl.value) filled.phone = 1; else missing.push('phone');
    if (peopleEl) {
      const has = (v) => Array.prototype.slice.call(peopleEl.options || []).some((o) => o.value === String(v));
      const first = ((peopleEl.options || [])[1] || {}).value || '';
      const pick = want.people ? (has(want.people) ? want.people : '') : first;   // 미지정이면 사이트 첫 번째 인원(테마 최소 인원)
      if (pick && String(peopleEl.value) !== String(pick)) setV(peopleEl, pick);  // 사이트 change 핸들러가 요금(#evePrice)을 채운다
      if (peopleEl.value) filled.people = peopleEl.value; else missing.push('people(인원을 직접 선택하세요)');
    } else missing.push('people');
    if (pays.length === 1) { if (!pays[0].checked) pays[0].click(); filled.pay = pays[0].value; }
    else if (pays.length > 1) missing.push('payment_method(선택지 ' + pays.length + '개 — 사람이 선택)');
    else missing.push('payment_method');
    if (policyEl && !policyEl.checked) policyEl.click();
    if (policyEl && policyEl.checked) filled.policy = 1; else if (policyEl) missing.push('policy');
    window.__RHE_FILL = {
      at: Date.now(), ms: performance.now() - t0, state: missing.length ? 'partial' : 'done',
      filled, missing,
      hidden: ['branch', 'theme', 'date', 'time'].reduce((a, k) => { const e = form.querySelector('[name="' + k + '"]'); if (e) a[k] = e.value; return a; }, {}),
      price: ((document.querySelector('#evePrice') || {}).textContent || '').trim(), href: location.pathname,
    };
  };
  tick();
}

/** 신청서 상태 스냅샷 — 자동입력 결과와 '사람이 눌러야 할 버튼'의 조건을 함께 보여준다 */
export function rheCreateRead() {
  const nameEl = document.querySelector('form[action$="/reservation/create"] [name="name"]') || document.querySelector('input[name="name"]');
  const form = nameEl ? nameEl.form : null;
  const val = (n) => { const e = form ? form.querySelector('[name="' + n + '"]') : null; return e ? String(e.value || '') : null; };
  const chk = (n) => { const e = form ? form.querySelector('[name="' + n + '"]') : null; return e ? !!e.checked : null; };
  const pays = form ? Array.prototype.slice.call(form.querySelectorAll('[name="payment_method"]')) : [];
  const payOn = pays.filter((p) => p.checked)[0];
  const payLabel = (e) => ((e && e.parentNode ? e.parentNode.textContent : '') || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const btn = document.querySelector('#eveReservationBtn');
  const F = window.__RHE_FILL || null;
  return {
    href: location.href.slice(0, 110),
    onCreate: /\/reservation\/create/.test(location.pathname),
    onDone: /\/reservation\/done/.test(location.pathname),
    onConfirm: /\/reservation\/confirm/.test(location.pathname),
    hidden: ['branch', 'theme', 'date', 'time'].reduce((a, k) => { a[k] = val(k); return a; }, {}),
    summary: (((document.querySelector('.reservation-form-table') || {}).innerText) || '').replace(/\s+/g, ' ').slice(0, 70),
    name: (val('name') || '').slice(0, 6), phone: (val('phone') || '').slice(0, 13),
    people: val('people'), pay: payOn ? payLabel(payOn) : '', payOptions: pays.map((p) => p.value).join('/'),
    policy: chk('policy'),
    price: ((document.querySelector('#evePrice') || {}).textContent || '').trim(),
    button: btn ? (((btn.textContent) || '').trim() + (btn.disabled ? '(비활성)' : '')) : '',
    fillAt: F ? F.at : null, fillMs: F && F.ms != null ? Math.round(F.ms) : null,
    fillState: F ? F.state : null, fillMissing: F ? (F.missing || []).join(',') : '',
    body: (document.body ? document.body.innerText.replace(/\s+/g, ' ') : '').slice(0, 120),
  };
}

