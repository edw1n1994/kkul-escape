/**
 * 오늘의 한 페이지(page-today.co.kr, 강남) 사이트 어댑터
 *
 * 호스팅: Reserv Company 의 예약 API + Vite 단일 페이지. 실측 (2026-10-02, 비로그인):
 *   · 지점      GET /api/booking/stores            → data[0].keycode (지점 1곳 = 강남점)
 *   · 카탈로그  GET /api/booking/stores/{keycode}  → { shop:{start_date,end_date,…}, themes:[…] } (약 45KB JSON)
 *       shop.end_date = 오늘+7 이지만 실제 테마의 슬롯은 오늘+6 까지만 있다(+7 은 '매진' 으로 그려진다)
 *       → 창 끝은 '실제 테마에 슬롯이 있는 마지막 날짜' 로 보고, 슬롯이 없으면 end_date 를 쓴다
 *       themes[i] = { id, title, description('장르: … / 난이도: …'), custom_forms[참여인원 설정: 2명/3명/4명],
 *                     default_deposit, booking_open_at(null), slots:[{ id, day_date, integer_to_time, can_book, left_stock }] }
 *       화면은 제목 표(버디·용팔도령)에 있는 테마만 보여 준다 → '예약하지 마세요' 안내용·테스트 테마는 뺀다
 *   · 화면 흐름 (#themes) — 클릭은 모두 화면 버튼으로만 한다 (우리가 API 로 예약을 만들지 않는다)
 *       [data-select-theme=<slug>] (aria-label '<제목> 예약하기') → 01 날짜 [data-date=YYYY-MM-DD]
 *       → 시간 [data-slot=<slot.id>] (aria-label '09:30 예약 가능' / '매진', 매진은 disabled)
 *       → [data-book-next] '다음 페이지' → 02 예약정보 select[name=players] · #booking-name · #booking-phone · #booking-memo
 *       → [data-book-next] '다음 페이지' → 03 확인 → [data-book-next] **'예약 확정'** = POST /api/booking/bookings (예약 생성)
 *     연락처는 '실제 연락 가능한 010 번호' 검사가 있다 (010-0000-0000 은 거부).
 *   · 개발자도구 감지: 디버거의 Runtime 도메인을 켜면(console 연결) '예약 화면을 잠시 보호하고 있어요' 화면으로 바뀐다.
 *     Page 도메인 + Runtime.evaluate 만 쓰면 감지되지 않는다 → 러너는 이 사이트에서 Runtime.enable 을 하지 않는다.
 *     감지기를 끄거나 바꾸는 코드는 넣지 않는다.
 *   · 오픈 규칙 공지·booking_open_at 이 없다 → end_date 가 하루 밀리는 시각을 자정으로 본다.
 *
 * 정책: 날짜·시간·인원·이름·연락처까지 채우고 03 확인 화면에서 멈춘다. '예약 확정' 은 기본은 사람 클릭이고,
 *       사용자가 켠 경우(--final-submit)에만 ptdSubmit 게이트를 통과하면 1회 누른다.
 *   · 결과 상자 .state[data-motion-state]: submitting → success('예약이 … 기록되었습니다') / conflict(다른 사람이 먼저) / unknown / error
 */

export const PTD = {
  key: 'ptd',
  base: 'https://page-today.co.kr',
  page: '/#themes',
  api: '/api/booking',
  label: '오늘의 한 페이지(강남)',
  branch: 1,
  branches: [[1, '강남점']],
  leadDays: 6,        // 실측: 실제 테마 슬롯의 마지막 날짜 = 오늘+6 (카탈로그가 매번 알려 주므로 관측값이 항상 우선)
  openTime: '00:00',
  finalButton: '예약 확정',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const DAY_MS = 86400000;
export const ptdToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
/** 화면이 숨기는 테마 — 예약 안내용 · 테스트용 */
const HIDDEN_THEME = /예약하지\s*마세요|테스트/;

async function getJson(path) {
  const r = await fetch(PTD.base + PTD.api + path, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: PTD.base + '/' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${PTD.label} 예약 서버 응답 HTTP ${r.status}`);
  const j = await r.json();
  if (j && j.result && j.result !== 'success') throw new Error(`${PTD.label} 예약 서버 응답 ${j.result}`);
  return j.data;
}

let KEY = { at: 0, keycode: '' };
async function keycode() {
  if (KEY.keycode && Date.now() - KEY.at < 3600000) return KEY.keycode;
  const list = await getJson('/stores');
  const s = Array.isArray(list) ? list[0] : list;
  if (!s || !s.keycode) throw new Error('지점 코드를 찾지 못했습니다');
  KEY = { at: Date.now(), keycode: String(s.keycode) };
  return KEY.keycode;
}

/** 카탈로그 원본(JSON). 폴링마다 새로 받는다 — 같은 순간의 날짜표가 필요하면 한 번 받아 parse 를 여러 번 쓴다 */
export async function ptdCatalog() {
  return await getJson('/stores/' + encodeURIComponent(await keycode()));
}

/** 설명 문구 '장르: 스릴러 / 난이도: 3 / 공포도: 3' 에서 값 하나 */
const descField = (d, k) => ((String(d || '').match(new RegExp(k + '\\s*:\\s*([^/\\n]+)')) || [])[1] || '').trim();

/** 카탈로그 → { shop, today, windowEnd, themes:[{theme, name, players:[2,3,4], …, slots}] } */
export function parsePtdCatalog(data, today = ptdToday()) {
  const shop = (data && data.shop) || {};
  const themes = [];
  for (const t of (data && data.themes) || []) {
    if (!t || t.is_deleted || HIDDEN_THEME.test(String(t.title || ''))) continue;
    const form = (t.custom_forms || []).find((f) => f && f.is_using !== false && /인원/.test(String(f.title || ''))) || null;
    const players = form ? (form.variables || []).map((v) => Number(String(v.value1 || '').replace(/\D/g, ''))).filter((n) => n > 0) : [];
    themes.push({
      theme: Number(t.id), info: Number(t.id), name: String(t.title || '').trim(),
      genre: descField(t.description, '장르'), level: descField(t.description, '난이도'), play: '',
      personRange: players.length ? `${Math.min(...players)}~${Math.max(...players)}` : '',
      minPerson: players.length ? Math.min(...players) : null, maxPerson: players.length ? Math.max(...players) : null,
      players, deposit: Number(t.default_deposit) || 0, doing: '', notice: '',
      slots: (t.slots || []).map((s) => ({
        num: Number(s.id), theme: Number(t.id), name: String(t.title || '').trim(), date: String(s.day_date || ''),
        time: String(s.integer_to_time || '').slice(0, 5),
        open: s.can_book === true && Number(s.left_stock) > 0,
        label: s.can_book === true && Number(s.left_stock) > 0 ? '예약 가능' : '매진',
      })),
    });
  }
  const last = themes.flatMap((t) => t.slots.map((s) => s.date)).filter(Boolean).sort().pop() || null;
  return { shop, today, windowStart: shop.start_date || today, windowEnd: last || shop.end_date || null, shopEnd: shop.end_date || null, themes };
}

/** 테마 목록(UI 드롭다운 재료) */
export async function ptdThemes() {
  try {
    const p = parsePtdCatalog(await ptdCatalog());
    const themes = p.themes.map(({ slots, ...t }) => t);
    return { ok: themes.length > 0, themes, msg: themes.length ? '' : '예약 가능한 테마가 없습니다' };
  } catch (e) { return { ok: false, themes: [], msg: String(e.message || e).slice(0, 90) }; }
}

/** 카탈로그 하나에서 그 날짜의 시간대 (러너 공통 모양) */
export function ptdDay(p, theme, date) {
  if (p.windowEnd && date > p.windowEnd) {
    return { ok: true, date, slots: [], open: 0, total: 0, notOpen: true, windowEnd: p.windowEnd,
      msg: `예약 창 밖 — 예약 서버에 ${p.windowEnd} 까지만 시간표가 있습니다` };
  }
  const want = theme === '' || theme == null ? null : String(theme);
  const slots = p.themes.filter((t) => !want || String(t.theme) === want)
    .flatMap((t) => t.slots.filter((s) => s.date === date))
    .sort((a, b) => a.time.localeCompare(b.time) || a.theme - b.theme);
  return {
    ok: true, date, slots, open: slots.filter((s) => s.open).length, total: slots.length,
    notOpen: false, past: date < p.today, windowEnd: p.windowEnd,
    msg: slots.length ? '' : '이 날짜에 시간표가 없습니다',
  };
}

export async function ptdTimes({ theme = '', date = ptdToday() } = {}) {
  try { return ptdDay(parsePtdCatalog(await ptdCatalog()), theme, date); }
  catch (e) { return { ok: false, date, slots: [], msg: String(e.message || e).slice(0, 90) }; }
}

/** 그 날짜가 열리는 시각 — 창 끝은 카탈로그(end_date) 가 직접 알려 준다. 시각은 공지가 없어 자정 가정 */
export async function ptdOpenInfo({ date = '' } = {}) {
  const today = ptdToday();
  let end = null;
  try { end = parsePtdCatalog(await ptdCatalog(), today).windowEnd; } catch { end = null; }
  const lead = end ? dayDiff(end, today) : PTD.leadDays;
  const base = {
    site: PTD.key, branch: PTD.branches[0][1], openTime: PTD.openTime,
    openTimeSource: `사이트에 오픈 시각 공지 없음 — 예약 창(오늘+${lead})이 밀리는 시각을 00:00 으로 가정`,
    leadDays: lead, leadSource: end ? `예약 서버에 시간표가 있는 마지막 날짜 ${end} (오늘 +${lead}일)` : `기본값 오늘+${PTD.leadDays}`,
    today, date: date || null, windowEnd: end,
  };
  if (!date) return { ok: false, ...base, note: '날짜 미선택' };
  const shift = dayDiff(date, today);
  if (shift < 0) return { ok: false, ...base, note: '지난 날짜입니다', past: true };
  const openDate = new Date(Date.parse(today + 'T00:00:00Z') + (shift - lead) * DAY_MS).toISOString().slice(0, 10);
  const openAt = `${openDate}T${PTD.openTime}:00+09:00`;
  return {
    ok: true, ...base, openDate, openAt, msUntil: Date.parse(openAt) - Date.now(), past: Date.parse(openAt) < Date.now(),
    inWindow: shift <= lead,
    note: shift > lead ? '창 밖 날짜입니다 — 위 시각에 열린다고 가정했습니다 (공지 없음)' : '이미 열린 날짜입니다',
  };
}


/* ================= 브라우저 측 (CDP 로 문자열화해 실행 — Runtime.enable 없이 Runtime.evaluate 만) ================= */

/** 화면 상태 스냅샷 — 몇 쪽인지, 고른 값, 다음 버튼 라벨(= '예약 확정' 이면 사람 차례) */
export function ptdRead() {
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (s) => document.querySelector(s);
  const next = q('[data-book-next]');
  const nextLabel = next ? (next.innerText || '').replace(/\s+/g, ' ').trim() : '';
  const val = (s) => { const e = q(s); return e ? String(e.value || '') : null; };
  const date = q('[data-date][aria-pressed="true"]');
  const slot = q('[data-slot][aria-pressed="true"]');
  const state = q('.state[data-motion-state]');   // 예약 결과 상자: submitting → success / conflict / unknown / error
  const F = window.__PTD_FILL || null;
  const nameV = val('#booking-name') || '';
  return {
    href: location.href.slice(0, 110),
    guard: !!q('.devtools-guard-screen'),
    themes: Array.prototype.slice.call(document.querySelectorAll('[data-select-theme]')).filter(vis).length,
    bookOpen: vis(q('[data-book-close]')),
    page: !vis(q('[data-book-close]')) ? 0 : vis(q('#booking-name')) ? 2 : nextLabel === '예약 확정' ? 3 : 1,
    date: date ? date.getAttribute('data-date') : '', slot: slot ? slot.getAttribute('data-slot') : '',
    slotLabel: slot ? (slot.getAttribute('aria-label') || '') : '',
    name: nameV.slice(0, 6), phone: (val('#booking-phone') || '').slice(0, 13), people: val('select[name="players"]'),
    nextLabel, nextDisabled: next ? !!next.disabled : null,
    onCreate: nextLabel === '예약 확정',
    onDone: !!(state && /^(success|conflict|unknown|error)$/.test(state.getAttribute('data-motion-state') || '')),
    state: state ? state.getAttribute('data-motion-state') : '',
    errors: Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((e) => e.name || e.id).join(','),
    summary: ((q('[data-book-page="3"]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 120),
    fillAt: F ? F.at : null, fillMs: F && F.ms != null ? Math.round(F.ms) : null, fillState: F ? F.state : null,
    fillMissing: F ? (F.missing || []).join(',') : '',
    body: (document.body ? document.body.innerText.replace(/\s+/g, ' ') : '').slice(0, 120),
  };
}

/**
 * 테마 → 날짜 → 시간 → 다음 → 예약정보 입력 → 다음 → 03 확인 화면에서 멈춘다 (Promise 를 돌려준다 — awaitPromise 로 기다린다).
 * 각 단계는 화면 버튼만 누르고, 아래를 모두 통과해야 다음으로 간다. 하나라도 걸리면 그 자리에서 멈추고 이유를 돌려준다.
 *   · 감지 화면(devtools-guard) 이 아닐 것 · 테마 선택 버튼이 제목으로 정확히 1개
 *   · 날짜 버튼이 비활성/매진이 아닐 것 · 시간 버튼 data-slot = 목표 slot.id, aria-label 에 목표 시각 + '예약 가능'
 *   · '다음' 버튼 라벨이 '다음 페이지' 일 때만 누른다 — **'예약 확정' 이면 절대 누르지 않는다**
 *   · 이 문서에서 이미 진행한 적이 없을 것 (실패해도 재시도하지 않는다)
 * opt = { title, date, slot, time, players, name, phone, preview }
 */
export function ptdPick(opt) {
  const o = opt || {};
  const t0 = performance.now();
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await nap(40); } };
  const setV = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, String(v)); else el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const nextBtn = () => q('[data-book-next]');
  const nextLabel = () => ((nextBtn() || {}).innerText || '').replace(/\s+/g, ' ').trim();
  const done = (ok, step, problems, extra) => {
    const r = Object.assign({ ok, step, problems: problems || [], ms: Math.round(performance.now() - t0) }, extra || {});
    window.__PTD_FILL = { at: Date.now(), ms: performance.now() - t0, state: ok ? 'done' : 'err', missing: r.problems };
    return r;
  };
  const goNext = async (step) => {
    const b = await until(() => { const n = nextBtn(); return n && vis(n) && !n.disabled && nextLabel() === '다음 페이지' ? n : null; }, 6000);
    if (!b) return '다음 버튼 대기 실패 (라벨 ' + nextLabel() + ')';
    if (nextLabel() === '예약 확정') return "'예약 확정' 은 누르지 않습니다";
    b.click();
    return '';
  };
  return (async () => {
    const problems = [];
    if (!/page-today\.co\.kr$/.test(location.hostname) && !o.allowHost) problems.push('사이트가 아님: ' + location.hostname);
    if (q('.devtools-guard-screen')) problems.push('개발자도구 감지 화면이 떠 있습니다 (새로고침 필요)');
    if (window.__PTD_PICKED) problems.push('이미 진행한 회차입니다');
    const sel = await until(() => qa('[data-select-theme]').filter((b) => vis(b)
      && String(b.getAttribute('aria-label') || '').indexOf(String(o.title || '') + ' 예약하기') === 0), 8000);
    if (!sel || sel.length !== 1) problems.push('테마 버튼 ' + (sel ? sel.length : 0) + '개: ' + o.title);
    if (problems.length || o.preview) return done(!problems.length, 'theme', problems, { preview: !!o.preview });
    window.__PTD_PICKED = Date.now();
    sel[0].click();
    // 01 날짜
    const dBtn = await until(() => { const b = q('[data-date="' + o.date + '"]'); return b && vis(b) ? b : null; }, 6000);
    if (!dBtn) return done(false, 'date', ['날짜 버튼 없음: ' + o.date]);
    if (dBtn.disabled || dBtn.hasAttribute('data-date-disabled') || dBtn.hasAttribute('data-date-sold-out')) {
      return done(false, 'date', ['날짜 선택 불가: ' + (dBtn.getAttribute('data-date-disabled') || (dBtn.hasAttribute('data-date-sold-out') ? '매진' : '비활성'))]);
    }
    if (dBtn.getAttribute('aria-pressed') !== 'true') dBtn.click();
    // 시간
    const sBtn = await until(() => { const b = q('[data-slot="' + o.slot + '"]'); return b && vis(b) ? b : null; }, 6000);
    if (!sBtn) return done(false, 'slot', ['시간 버튼 없음: slot ' + o.slot]);
    const lab = sBtn.getAttribute('aria-label') || '';
    if (sBtn.disabled || lab.indexOf(String(o.time)) !== 0 || !/예약\s*가능/.test(lab)) return done(false, 'slot', ['시간 버튼이 목표와 다름/매진: ' + lab]);
    sBtn.click();
    // 화면이 클릭 직후 시간 버튼을 새로 그린다 → 잡아 둔 요소가 아니라 같은 data-slot 을 다시 찾아 확인한다
    const pressed = () => { const b = q('[data-slot="' + o.slot + '"]'); return !!b && b.getAttribute('aria-pressed') === 'true'; };
    if (!(await until(pressed, 3000))) return done(false, 'slot', ['시간 선택이 반영되지 않음']);
    let w = await goNext('slot');
    if (w) return done(false, 'page1', [w]);
    // 02 예약정보
    const nameEl = await until(() => { const e = q('#booking-name'); return e && vis(e) ? e : null; }, 6000);
    if (!nameEl) return done(false, 'page2', ['예약정보 입력란이 열리지 않음']);
    const pl = q('select[name="players"]');
    const has = (v) => pl && Array.prototype.slice.call(pl.options).some((x) => x.value === String(v));
    const firstP = pl ? (Array.prototype.slice.call(pl.options).find((x) => x.value) || {}).value : '';
    const pick = o.players && has(o.players) ? String(o.players) : firstP;
    if (pl && pick) setV(pl, pick);
    if (o.name) setV(nameEl, o.name);
    const ph = q('#booking-phone');
    if (ph && o.phone) setV(ph, String(o.phone).replace(/[^0-9]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'));
    const missing = [];
    if (!nameEl.value) missing.push('name');
    if (!ph || !ph.value) missing.push('phone');
    if (!pl || !pl.value) missing.push('players');
    if (missing.length) return done(false, 'page2', ['입력 누락: ' + missing.join(',')]);
    await nap(120);
    w = await goNext('page2');
    if (w) return done(false, 'page2', [w]);
    const confirm = await until(() => nextLabel() === '예약 확정', 6000);
    const bad = qa('[aria-invalid="true"]').map((e) => e.name || e.id);
    if (!confirm) return done(false, 'page2', ['확인 화면으로 넘어가지 않음' + (bad.length ? ' — 입력 오류: ' + bad.join(',') : '')]);
    return done(true, 'confirm', [], { players: pl ? pl.value : '', why: "03 확인 화면 — '예약 확정' 은 사람이 누릅니다" });
  })();
}

/**
 * 03 확인 화면의 '예약 확정' — **사용자가 켠 경우(--final-submit)에만** 쓰는 1회 클릭 게이트 (preview:true 면 검사만).
 *   · 감지 화면 아님 · 다음 버튼 라벨이 정확히 '예약 확정' 이고 보이며 활성
 *   · 확인 화면 요약에 목표 날짜·시각·테마·이름·연락처·인원이 모두 있음 · 입력 오류 표시 없음
 *   · 이 문서에서 처음 누름 (응답이 불명확해도 다시 누르지 않는다)
 * opt = { date, time, title, name, phone, players, preview }
 */
export function ptdSubmit(opt) {
  const o = opt || {};
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (s) => document.querySelector(s);
  const next = q('[data-book-next]');
  const label = next ? (next.innerText || '').replace(/\s+/g, ' ').trim() : '';
  const sum = ((q('[data-book-page="3"]') || {}).innerText || '').replace(/\s+/g, ' ');
  const phone = String(o.phone || '').replace(/[^0-9]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  const problems = [];
  if (q('.devtools-guard-screen')) problems.push('개발자도구 감지 화면');
  if (label !== '예약 확정') problems.push('확정 버튼 라벨: ' + (label || '없음'));
  else if (!vis(next) || next.disabled) problems.push('확정 버튼이 보이지 않거나 비활성');
  for (const [k, v] of [['날짜', o.date], ['시각', o.time], ['테마', o.title], ['이름', o.name], ['연락처', phone], ['인원', o.players ? o.players + '명' : '']]) {
    if (v && sum.indexOf(String(v)) < 0) problems.push('확인 화면에 ' + k + ' 없음: ' + v);
  }
  const bad = Array.prototype.slice.call(document.querySelectorAll('[aria-invalid="true"]')).map((e) => e.name || e.id);
  if (bad.length) problems.push('입력 오류: ' + bad.join(','));
  if (window.__PTD_SUBMITTED) problems.push('이미 예약 확정을 눌렀습니다');
  const out = { ok: false, label, summary: sum.slice(0, 120), problems };
  if (o.preview || problems.length) return out;
  window.__PTD_SUBMITTED = Date.now();
  next.click();
  out.ok = true; out.clickedAt = window.__PTD_SUBMITTED;
  return out;
}
