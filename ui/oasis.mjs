/**
 * 오아시스 뮤지엄(oasismuseum.com, 홍대) 사이트 어댑터
 *
 * 호스팅: 자체 PHP + jQuery. 실측 (2026-10-02, 비로그인):
 *   · 예약 화면  GET /ticket?date=YYYY-MM-DD&id=<tm> → HTML 한 장 (모든 테마의 그 날짜 시간 버튼이 들어 있다)
 *       테마  <select id="res_tm"> → 1 업사이드 다운 · 5 미씽 삭스 미스터리 · 6 배드 타임 · 8 하이 맥스 · 15 4 SUM 1
 *       시간  <button id="sd_btn{tm}_{n}" class="room_btn room_btn{tm} …" data-tm data-time="09:50" data-discount value="{n}">
 *             n(회차 번호) 은 날짜마다 다르다(평일/주말 시간표) → 반드시 그 날짜의 화면에서 읽는다
 *       요금  인라인 스크립트 price_info["1"]["2"] = 58000 … (테마별 인원 → 금액)
 *       datepicker minDate '-0d', maxDate '+6d' → 오늘~오늘+6. 창 밖 날짜는
 *       `<script>alert('예약할 수 없는 날짜입니다.');history.back();</script>` 만 돌려준다
 *   · 마감 목록  POST /ticket/getSchedule {tm, date} → 이미 예약된 회차 번호 배열 (없으면 null)
 *       화면은 이 목록의 버튼을 disabled + btn-closed 로 바꾼다
 *   · 시간 클릭  jQuery 위임 핸들러가 #f_tm/#f_sd_n/#f_sd_time 을 채우고 #step2(정보 입력) 를 연다
 *       동시에 POST /ticket/reserveInfo {date, sd_n} 를 보낸다(사이트 자체 동작)
 *   · 정보 입력  #f_name · #f_tel(010-0000-0000) · #f_person(테마별 인원) · #f_agree(동의) → #v_price 에 금액
 *   · 제출      #f_submit '예약하기' → POST /ticket/payment (3. 결제하기 — 안내문상 카드 또는 무통장 입금, 무통장은 10분 안에 입금해야 확정)
 *   · 오픈 규칙 사이트 안내문: "매일 밤 자정에 6일 후의 예약이 가능합니다.(예시 : 1월 1일에서 2일로 넘어가는 자정에 1월 8일 예약이 가능)"
 *             → openAt(D) = (D-6일) 00:00 KST. 디버거 감지 없음.
 *
 * 정책: 시간 버튼 클릭과 정보 입력·동의까지는 자동. '예약하기'(결제 화면으로 이동) 는 기본은 사람 클릭이고,
 *       사용자가 켠 경우(--final-submit)에만 oasSubmit 게이트를 통과하면 1회 누른다. 결제 화면(카드·무통장) 은 아직 실측 전이라 사람이 한다.
 * 실측: 시간 버튼 클릭(reserveInfo) 전후로 getSchedule 마감 목록이 바뀌지 않았다 → 클릭만으로 자리를 잡아 두지 않는다.
 */

export const OAS = {
  key: 'oas',
  base: 'https://oasismuseum.com',
  page: '/ticket',
  label: '오아시스 뮤지엄(홍대)',
  branch: 1,
  branches: [[1, '홍대']],
  leadDays: 6,
  openTime: '00:00',
  payMethod: '카드 또는 무통장 입금',
  finalButton: '예약하기',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const DAY_MS = 86400000;
export const oasToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
const strip = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const oasUrl = ({ theme = '', date = '' } = {}) =>
  `${OAS.base}${OAS.page}${date || theme ? '?' : ''}${date ? 'date=' + encodeURIComponent(date) : ''}${date && theme ? '&' : ''}${theme ? 'id=' + encodeURIComponent(theme) : ''}`;

/** 예약 화면인지 (창 밖이면 alert 스크립트 한 줄만 온다) */
export const isOasPage = (html) => /id="ticket_form"/.test(String(html || '')) && /id="res_tm"/.test(String(html || ''));

/** 예약 화면 → { date, themes:[{theme,name,full,prices}], buttons:[{theme,num,time,discount}] } */
export function parseOasPage(html) {
  const h = String(html || '');
  const date = (h.match(/id="res_date"[^>]*value="(\d{4}-\d{2}-\d{2})"/) || [])[1] || null;
  const sel = (/<select[^>]*id="res_tm"[\s\S]*?<\/select>/.exec(h) || [''])[0];
  const prices = {};
  for (const m of h.matchAll(/price_info\["(\d+)"\]\["(\d+)"\]\s*=\s*(\d+)/g)) (prices[m[1]] = prices[m[1]] || {})[m[2]] = Number(m[3]);
  const full = {};
  for (const m of h.matchAll(/id="tm_name(\d+)"[^>]*>([\s\S]*?)<\//g)) full[m[1]] = strip(m[2]);
  const themes = [...sel.matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((o) => ({ theme: Number(o[1]), name: strip(o[2]), full: full[o[1]] || '', prices: prices[o[1]] || {} }));
  const buttons = [];
  for (const m of h.matchAll(/<button([^>]*class="[^"]*\broom_btn\b[^"]*"[^>]*)>/g)) {
    const a = m[1];
    const attr = (k) => ((a.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '');
    const id = attr('id').match(/^sd_btn(\d+)_(\d+)$/);
    if (!id) continue;
    buttons.push({ theme: Number(attr('data-tm') || id[1]), num: Number(attr('value') || id[2]), time: attr('data-time'), discount: Number(attr('data-discount')) || 0 });
  }
  return { date, themes, buttons };
}

async function oasPage(date, theme) {
  const r = await fetch(oasUrl({ date, theme }), { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${OAS.label} 예약 화면 응답 HTTP ${r.status}`);
  return await r.text();
}

/** 이미 예약된(마감) 회차 번호 목록 */
export async function oasClosed(theme, date) {
  const r = await fetch(OAS.base + '/ticket/getSchedule', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: oasUrl({ date, theme }) },
    body: `tm=${encodeURIComponent(theme)}&date=${encodeURIComponent(date)}`, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${OAS.label} 마감 목록 응답 HTTP ${r.status}`);
  const j = JSON.parse((await r.text()) || 'null');
  return Array.isArray(j) ? [...new Set(j.map(Number))] : [];
}

/** 테마 목록 — 인원 범위는 요금표(price_info) 의 인원 키 */
export async function oasThemes() {
  let p = null;
  try { p = parseOasPage(await oasPage(oasToday(), '')); } catch (e) { return { ok: false, themes: [], msg: String(e.message || e).slice(0, 90) }; }
  const themes = p.themes.map((t) => {
    const ns = Object.keys(t.prices).map(Number).sort((a, b) => a - b);
    return {
      theme: t.theme, info: t.theme, name: t.name, full: t.full, genre: '', level: '', play: '',
      personRange: ns.length ? `${ns[0]}~${ns[ns.length - 1]}` : '', minPerson: ns[0] || null, maxPerson: ns[ns.length - 1] || null,
      prices: t.prices, doing: '', notice: '',
    };
  });
  return { ok: themes.length > 0, themes, msg: themes.length ? '' : '테마 목록이 비어 있습니다' };
}

/** 그 날짜의 시간대 — 화면의 버튼 + 마감 목록 */
export async function oasTimes({ theme = '', date = oasToday() } = {}) {
  let h = '';
  try { h = await oasPage(date, theme); } catch (e) { return { ok: false, date, slots: [], msg: String(e.message || e).slice(0, 90) }; }
  if (!isOasPage(h)) {
    return { ok: true, date, slots: [], open: 0, total: 0, notOpen: true,
      msg: `예약 창 밖 — 사이트가 '예약할 수 없는 날짜' 로 되돌립니다 (오늘부터 +${OAS.leadDays}일까지만 예약)` };
  }
  const p = parseOasPage(h);
  const want = theme === '' || theme == null ? null : Number(theme);
  const tms = want ? [want] : [...new Set(p.buttons.map((b) => b.theme))];
  const slots = [];
  for (const tm of tms) {
    let closed;
    try { closed = await oasClosed(tm, date); } catch (e) { return { ok: false, date, slots: [], msg: String(e.message || e).slice(0, 90) }; }
    const name = (p.themes.find((t) => t.theme === tm) || {}).name || '';
    for (const b of p.buttons.filter((x) => x.theme === tm)) {
      const open = !closed.includes(b.num);
      slots.push({ num: b.num, theme: tm, name, time: b.time, open, label: open ? '예약 가능' : '마감', discount: b.discount });
    }
  }
  slots.sort((a, b) => a.time.localeCompare(b.time) || a.theme - b.theme);
  const today = oasToday();
  return {
    ok: true, date, serverToday: p.date, slots, open: slots.filter((s) => s.open).length, total: slots.length,
    notOpen: false, past: date < today, msg: slots.length ? '' : '이 날짜에 시간표가 없습니다',
  };
}

/** 그 날짜가 열리는 시각 — 창(오늘+6, datepicker maxDate) 기준 자정 가정 */
export async function oasOpenInfo({ date = '' } = {}) {
  const today = oasToday();
  const lead = OAS.leadDays;
  const base = {
    site: OAS.key, branch: OAS.branches[0][1], openTime: OAS.openTime,
    openTimeSource: `사이트 안내문: 매일 밤 자정에 ${lead}일 후의 예약이 열림`,
    leadDays: lead, leadSource: `사이트 안내문 + 달력 maxDate '+${lead}d' · 창 밖 날짜는 '예약할 수 없는 날짜' (실측)`,
    today, date: date || null, windowEnd: null,
  };
  if (!date) return { ok: false, ...base, note: '날짜 미선택' };
  const shift = dayDiff(date, today);
  if (shift < 0) return { ok: false, ...base, note: '지난 날짜입니다', past: true };
  const openDate = new Date(Date.parse(today + 'T00:00:00Z') + (shift - lead) * DAY_MS).toISOString().slice(0, 10);
  const openAt = `${openDate}T${OAS.openTime}:00+09:00`;
  return {
    ok: true, ...base, openDate, openAt, msUntil: Date.parse(openAt) - Date.now(), past: Date.parse(openAt) < Date.now(),
    inWindow: shift <= lead,
    note: shift > lead ? '창 밖 날짜입니다 — 사이트 안내문대로 위 시각(자정)에 열립니다' : '이미 열린 날짜입니다',
  };
}


/* ================= 브라우저 측 (CDP 로 문자열화해 실행) ================= */

/** 예약 화면 스냅샷 — 고른 날짜와 목표 테마의 버튼 상태 */
export function oasSlotRead(tm) {
  const vis = (e) => !!e && e.offsetParent !== null;
  const btns = Array.prototype.slice.call(document.querySelectorAll('.room_btn' + (tm ? tm : '')));
  return {
    href: location.href.slice(0, 110),
    onTicket: /^\/ticket\/?$/.test(location.pathname),
    dateInput: (document.querySelector('#res_date') || {}).value || '',
    buttons: btns.filter(vis).length,
    open: btns.filter((b) => vis(b) && !b.disabled && /btn-opened/.test(b.className)).length,
    loaded: btns.some(vis),
    jq: typeof window.jQuery === 'function',
  };
}

/**
 * 시간 버튼 클릭 — 사이트 jQuery 위임 핸들러가 #step2 를 연다. 아래를 **모두** 통과해야 누른다.
 *   · /ticket 화면 · 화면 날짜 = 목표 날짜 · #sd_btn{tm}_{num} 이 정확히 그 버튼(data-tm·data-time 일치)
 *   · 보이고(loadSchedule 완료) disabled 아님 + btn-opened · jQuery 로드 · 이 문서에서 처음 누름
 * opt = { theme, num, time, date, preview }
 */
export function oasPick(opt) {
  const o = opt || {};
  const vis = (e) => !!e && e.offsetParent !== null;
  const btn = document.querySelector('#sd_btn' + o.theme + '_' + o.num);
  const problems = [];
  if (!/^\/ticket\/?$/.test(location.pathname)) problems.push('예약 화면이 아님: ' + location.pathname);
  const dateInput = (document.querySelector('#res_date') || {}).value || '';
  if (dateInput !== String(o.date)) problems.push('화면 날짜 ' + dateInput + '≠' + o.date);
  if (!btn) problems.push('시간 버튼 없음: sd_btn' + o.theme + '_' + o.num);
  else {
    if (String(btn.getAttribute('data-tm')) !== String(o.theme)) problems.push('테마 불일치 ' + btn.getAttribute('data-tm'));
    if (String(btn.getAttribute('data-time')) !== String(o.time)) problems.push('시각 불일치 ' + btn.getAttribute('data-time'));
    if (!vis(btn)) problems.push('버튼이 아직 안 보임(마감 목록 로딩 중)');
    if (btn.disabled || /btn-closed/.test(btn.className)) problems.push('마감된 회차');
    else if (!/btn-opened/.test(btn.className)) problems.push('열림 표시(btn-opened) 아님');
  }
  if (typeof window.jQuery !== 'function') problems.push('jQuery 없음');
  if (window.__OAS_PICKED) problems.push('이미 클릭한 회차입니다');
  const out = { ok: false, btn: btn ? String(btn.getAttribute('data-time')) + ' #' + o.num : '-', 좌표: [o.theme, o.date, o.time, o.num].join('/'), problems };
  if (o.preview || problems.length) return out;
  window.__OAS_PICKED = Date.now();
  btn.click();
  out.ok = true; out.clickedAt = window.__OAS_PICKED; out.why = '시간 버튼 클릭 완료 → 정보 입력 화면';
  return out;
}

/** 정보 입력 화면 채우기 — 이름·연락처·인원·동의. **#f_submit('예약하기') 는 건드리지 않는다.** (Promise) */
export function oasFiller(WANT) {
  const want = WANT || {};
  const t0 = performance.now();
  const vis = (e) => !!e && e.offsetParent !== null;
  const q = (s) => document.querySelector(s);
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const setV = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, String(v)); else el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return (async () => {
    const end = Date.now() + 8000;
    while (!(vis(q('#step2')) && (q('#f_sd_n') || {}).value)) {
      if (Date.now() > end) { window.__OAS_FILL = { at: Date.now(), state: 'err', missing: ['정보 입력 화면이 열리지 않음'] }; return window.__OAS_FILL; }
      await nap(40);
    }
    const missing = [];
    const nameEl = q('#f_name'), telEl = q('#f_tel'), perEl = q('#f_person'), agEl = q('#f_agree');
    if (want.name && nameEl) setV(nameEl, want.name);
    if (!nameEl || !nameEl.value) missing.push('name');
    if (want.phone && telEl) setV(telEl, String(want.phone).replace(/[^0-9]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'));
    if (!telEl || !telEl.value) missing.push('phone');
    if (perEl) {
      const has = (v) => Array.prototype.slice.call(perEl.options).some((x) => x.value === String(v));
      if (want.people && has(want.people) && perEl.value !== String(want.people)) setV(perEl, want.people);   // 사이트 change 핸들러가 금액을 다시 계산
      if (!perEl.value) missing.push('people');
    } else missing.push('people');
    if (agEl && !agEl.checked) agEl.click();
    if (!agEl || !agEl.checked) missing.push('agree');
    window.__OAS_FILL = {
      at: Date.now(), ms: performance.now() - t0, state: missing.length ? 'partial' : 'done', missing,
      hidden: { tm: (q('#f_tm') || {}).value, sd_n: (q('#f_sd_n') || {}).value, time: (q('#f_sd_time') || {}).value, date: (q('#f_date') || {}).value },
      price: ((q('#v_price') || {}).textContent || '').trim(),
    };
    return window.__OAS_FILL;
  })();
}

/** 정보 입력 화면 스냅샷 — 자동입력 결과와 '사람이 눌러야 할 버튼' */
export function oasCreateRead() {
  const vis = (e) => !!e && e.offsetParent !== null;
  const q = (s) => document.querySelector(s);
  const val = (s) => { const e = q(s); return e ? String(e.value || '') : null; };
  const F = window.__OAS_FILL || null;
  const btn = q('#f_submit');
  return {
    href: location.href.slice(0, 110),
    onCreate: /^\/ticket\/?$/.test(location.pathname) && vis(q('#step2')),
    onDone: /^\/ticket\/payment/.test(location.pathname),
    hidden: { tm: val('#f_tm'), sd_n: val('#f_sd_n'), time: val('#f_sd_time'), date: val('#f_date') },
    theme: ((q('#input_theme') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    name: (val('#f_name') || '').slice(0, 6), phone: (val('#f_tel') || '').slice(0, 13), people: val('#f_person'),
    price: ((q('#v_price') || {}).textContent || '').trim(), policy: q('#f_agree') ? !!q('#f_agree').checked : null,
    pay: '다음 화면에서 선택(카드·무통장)',
    button: btn ? ((btn.textContent || '').trim() + (btn.disabled ? '(비활성)' : '')) : '',
    fillAt: F ? F.at : null, fillMs: F && F.ms != null ? Math.round(F.ms) : null,
    fillState: F ? F.state : null, fillMissing: F ? (F.missing || []).join(',') : '',
    body: (document.body ? document.body.innerText.replace(/\s+/g, ' ') : '').slice(0, 120),
  };
}

/**
 * 정보 입력 화면의 '예약하기'(#f_submit → POST /ticket/payment) — **사용자가 켠 경우(--final-submit)에만** 쓰는 1회 클릭 게이트.
 *   · /ticket 화면, #step2 보임 · hidden(f_tm/f_sd_n/f_sd_time/f_date) = 목표 · 이름·연락처·인원 = 목표
 *   · 금액(f_price) 숫자 · 동의 체크 · 버튼 정확히 1개 · 이 문서에서 처음 누름
 * 클릭하면 사이트 formCheck() 가 검사한 뒤 결제 화면(3. 결제하기) 으로 넘어간다. 결제는 사람이 한다.
 * opt = { want:{tm,sd_n,time,date}, name, phone, people, preview }
 */
export function oasSubmit(opt) {
  const o = opt || {};
  const vis = (e) => !!e && e.offsetParent !== null;
  const q = (s) => document.querySelector(s);
  const val = (s) => { const e = q(s); return e ? String(e.value || '') : null; };
  const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
  const w = o.want || {};
  const problems = [];
  if (!/^\/ticket\/?$/.test(location.pathname)) problems.push('예약 화면이 아님: ' + location.pathname);
  if (!vis(q('#step2'))) problems.push('정보 입력 화면이 아님');
  for (const [k, sel] of [['tm', '#f_tm'], ['sd_n', '#f_sd_n'], ['time', '#f_sd_time'], ['date', '#f_date']]) {
    if (String(val(sel)) !== String(w[k])) problems.push('좌표 ' + k + ' ' + val(sel) + '≠' + w[k]);
  }
  if (!val('#f_name') || (o.name && val('#f_name') !== String(o.name))) problems.push('이름 불일치');
  if (!digits(val('#f_tel')) || (o.phone && digits(val('#f_tel')) !== digits(o.phone))) problems.push('연락처 불일치');
  if (!val('#f_person') || (o.people && val('#f_person') !== String(o.people))) problems.push('인원 ' + (val('#f_person') || '미선택') + '≠' + (o.people || '?'));
  if (!/^\d+$/.test(val('#f_price') || '')) problems.push('금액 없음');
  const ag = q('#f_agree');
  if (!ag || !ag.checked) problems.push('동의 미체크');
  const btns = Array.prototype.slice.call(document.querySelectorAll('#f_submit'));
  if (btns.length !== 1) problems.push('예약하기 버튼 ' + btns.length + '개');
  else if (btns[0].disabled) problems.push('예약하기 버튼 비활성');
  if (window.__OAS_SUBMITTED) problems.push('이미 예약하기를 눌렀습니다');
  const out = { ok: false, price: ((q('#v_price') || {}).textContent || '').trim(), people: val('#f_person'), 좌표: [val('#f_tm'), val('#f_sd_n'), val('#f_sd_time'), val('#f_date')].join('/'), problems };
  if (o.preview || problems.length) return out;
  window.__OAS_SUBMITTED = Date.now();
  btns[0].click();
  out.ok = true; out.clickedAt = window.__OAS_SUBMITTED;
  return out;
}
