/**
 * 신청서형 사이트 추가분 테스트 — 지구별(jgb) · 오늘의 한 페이지(ptd) · 오아시스 뮤지엄(oas). 오프라인으로 돈다.
 * 실측 마크업/JSON 을 줄여 옮긴 조각으로 파서를 고정하고, 브라우저 쪽 진행 함수는 vm 가짜 DOM 에서 돌려
 * '마지막 버튼(예약 확정 / 예약하기) 은 절대 누르지 않는다' 와 좌표 게이트를 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseRhePage, JGB, JGB_SITE, rheToday } from '../rhe.mjs';
import { parsePtdCatalog, ptdDay, ptdPick, ptdSubmit } from '../pagetoday.mjs';
import { parseOasPage, isOasPage, oasTimes, oasPick, oasFiller, oasSubmit } from '../oasis.mjs';

const DAY = 86400000;
const plusDays = (base, n) => new Date(Date.parse(base + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/* ---------------- 지구별: 토끼굴 템플릿 변형 ---------------- */
const JGB_HTML = `
<select class="bs-bb" name="branch"><option value="1">대구점</option><option value="2" selected>홍대어드벤처점</option></select>
<select class="bs-bb" name="theme"><option value="">전체</option><option value="23">잔향</option><option value="2">만월 &lt;&lt;꿈을 훔치는 요괴&gt;&gt;</option></select>
<input class="bsbb mask-date" type="text" name="date" value="2030-01-07" onChange="this.form.submit()">
<section class="res-item clear-b"><div><h2 class="ff-bhs pax3">잔향</h2><table class="ff-bhs pax3">
<tr><th>장르</th><td>드라마 / 서스펜스</td></tr><tr><th>인원</th><td>2-4</td></tr><tr><th>시간</th><td>60분</td></tr><tr><th>난이도</th><td>3.5</td></tr></table></div>
<ul class="res-times kit">
<li class="pax3"><div class="res-times-btn"><button class="active1 eveReservationButton" type="button"><label>예약가능</label><span class="ff-bhs">10:15</span><em></em>
<div class="d-n eveHiddenData">{&quot;branch&quot;:2,&quot;theme&quot;:23,&quot;date&quot;:&quot;2030-01-07&quot;,&quot;time&quot;:&quot;10:15&quot;}</div></button></div></li>
<li class="pax3"><div class="res-times-btn"><button type="button"><label>예약불가</label><span class="ff-bhs">11:40</span><em></em></button></div></li>
</ul></section>
<section class="res-item clear-b"><div><h2 class="ff-bhs pax3">만월 &lt;&lt;꿈을 훔치는 요괴&gt;&gt;</h2><table><tr><th>인원</th><td>2~6</td></tr></table></div>
<ul class="res-times kit"><li><div class="res-times-btn"><button type="button"><label>예약불가</label><span class="ff-bhs">12:00</span></button></div></li></ul></section>
<form class="d-n" method="post" action="https://www.xn--2e0b040a4xj.com/reservation/create#list" id="eveSubmitForm"><input type="hidden" name="_token" value="t"></form>`;

test('지구별: 클래스가 붙은 h2/span · res-item clear-b · 표의 난이도 · 엔티티 테마명을 읽는다', () => {
  const p = parseRhePage(JGB_HTML);
  assert.equal(p.today, '2030-01-07');
  assert.deepEqual(p.themes.map((t) => [t.value, t.label]), [['23', '잔향'], ['2', '만월 <<꿈을 훔치는 요괴>>']]);
  assert.equal(p.sections.length, 2);
  const [a, b] = p.sections;
  assert.equal(a.name, '잔향');
  assert.equal(a.level, '3.5');
  assert.deepEqual(a.slots.map((s) => [s.time, s.open]), [['10:15', true], ['11:40', false]]);
  assert.deepEqual(a.slots[0].data, { branch: 2, theme: 23, date: '2030-01-07', time: '10:15' });
  assert.equal(b.name, '만월 <<꿈을 훔치는 요괴>>');            // 드롭다운 라벨과 같은 문자열이어야 섹션을 찾는다
});

test('지구별: 지점마다 예약 창이 다르다 (대구 +14, 홍대 +6) · 관측한 창 끝은 지점별로 기억한다', async () => {
  const today = rheToday();
  assert.equal(JGB_SITE.leadFor(1), 14);
  assert.equal(JGB_SITE.leadFor(2), 6);
  assert.equal(JGB_SITE.leadFor('4'), 6);
  const daegu = await JGB_SITE.openInfo({ branch: 1, date: plusDays(today, 20) });
  assert.equal(daegu.openDate, plusDays(today, 6));
  assert.equal(daegu.branch, '대구점');
  const hongdae = await JGB_SITE.openInfo({ branch: 2, date: plusDays(today, 20) });
  assert.equal(hongdae.openDate, plusDays(today, 14));
  JGB_SITE.noteWindow(today, [0, 1, 2, 3, 4].map((n) => ({ date: plusDays(today, n), total: 5 })).concat([{ date: plusDays(today, 5), total: 0 }]), '4');
  assert.equal((await JGB_SITE.openInfo({ branch: 4, date: plusDays(today, 9) })).leadDays, 4);   // 관측값 우선
  assert.equal((await JGB_SITE.openInfo({ branch: 2, date: plusDays(today, 9) })).leadDays, 6);   // 다른 지점에는 번지지 않는다
  assert.equal(JGB.branches.length, 3);
});

/* ---------------- 오늘의 한 페이지: 카탈로그 JSON ---------------- */
const slot = (id, date, time, open) => ({ id, day_date: date, integer_to_time: time, can_book: open, left_stock: open ? 1 : 0 });
const CATALOG = {
  shop: { keycode: 'k', name: '강남점', start_date: '2030-01-07', end_date: '2030-01-14' },
  themes: [
    { id: 333, title: '버디', description: '장르: 스릴러 / 난이도: 3 / 공포도: 3', default_deposit: 58000,
      custom_forms: [{ title: '참여인원 설정', is_using: true, variables: [{ value1: '2명' }, { value1: '3명' }, { value1: '4명' }] }],
      slots: [slot(1, '2030-01-07', '09:40', false), slot(2, '2030-01-13', '10:45', true), slot(3, '2030-01-13', '09:40', true)] },
    { id: 342, title: '예약 안내 (예약하지 마세요)', custom_forms: [], slots: [slot(9, '2030-01-14', '00:00', true)] },
    { id: 702, title: '예약 테스트', custom_forms: [], slots: [slot(8, '2030-01-14', '00:00', true)] },
  ],
};

test('오늘의 한 페이지: 안내·테스트 테마는 빼고, 창 끝은 실제 슬롯의 마지막 날짜로 본다', () => {
  const p = parsePtdCatalog(CATALOG, '2030-01-07');
  assert.deepEqual(p.themes.map((t) => t.name), ['버디']);
  const t = p.themes[0];
  assert.deepEqual([t.players, t.personRange, t.genre, t.level, t.deposit], [[2, 3, 4], '2~4', '스릴러', '3', 58000]);
  assert.equal(p.shopEnd, '2030-01-14');
  assert.equal(p.windowEnd, '2030-01-13');                       // end_date(+7) 가 아니라 실제 시간표 끝(+6)
  const d = ptdDay(p, 333, '2030-01-13');
  assert.deepEqual(d.slots.map((s) => [s.time, s.num, s.open]), [['09:40', 3, true], ['10:45', 2, true]]);
  assert.equal(d.notOpen, false);
  const out = ptdDay(p, 333, '2030-01-14');
  assert.equal(out.notOpen, true);
  assert.match(out.msg, /2030-01-13 까지만/);
  assert.equal(ptdDay(p, 333, '2030-01-07').open, 0);            // can_book=false = 매진
});

/* ---------------- 오늘의 한 페이지: 화면 진행기 (가짜 DOM) ---------------- */
function ptdCtx(o = {}) {
  const clicks = { next: 0, confirm: 0, theme: 0, date: 0, slot: 0 };
  const st = { page: 0, slotPressed: false };
  const el = (attrs, extra = {}) => Object.defineProperties({
    attrs: { ...attrs }, disabled: false, innerText: '', value: '', options: [],
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    getBoundingClientRect() { return this.visible() ? { width: 10, height: 10 } : { width: 0, height: 0 }; },
    visible: () => true, dispatchEvent() {}, click() {},
  }, Object.getOwnPropertyDescriptors(extra));   // 펼치기(...) 는 getter 를 한 번 읽어 고정해 버린다
  const theme = el({ 'data-select-theme': 'buddy', 'aria-label': (o.title || '버디') + ' 예약하기 · 실제 예약 버디' }, { click() { clicks.theme++; st.page = 1; } });
  const date = el({ 'data-date': '2030-01-13', 'aria-pressed': 'false', ...(o.dateAttrs || {}) }, { visible: () => st.page >= 1, click() { clicks.date++; this.attrs['aria-pressed'] = 'true'; } });
  const slotBtn = el({ 'data-slot': '3', 'aria-pressed': 'false', 'aria-label': o.slotLabel || '09:40 예약 가능' }, {
    visible: () => st.page >= 1 && date.attrs['aria-pressed'] === 'true', click() { clicks.slot++; this.attrs['aria-pressed'] = 'true'; },
  });
  const next = el({ 'data-book-next': '' }, {
    get innerText() { return st.page === 3 ? '예약 확정' : '다음 페이지'; },
    get disabled() { return st.page === 1 && slotBtn.attrs['aria-pressed'] !== 'true'; },
    click() {
      if (st.page === 3) { clicks.confirm++; return; }
      clicks.next++;
      if (st.page === 1) st.page = 2;
      else if (st.page === 2) st.page = o.stuckOnPage2 ? 2 : 3;
    },
  });
  const name = el({ id: 'booking-name' }, { tagName: 'INPUT', visible: () => st.page === 2 });
  const phone = el({ id: 'booking-phone' }, { tagName: 'INPUT', visible: () => st.page === 2 });
  const players = el({ name: 'players' }, { tagName: 'SELECT', options: [{ value: '' }, { value: '2' }, { value: '3' }, { value: '4' }] });
  const map = {
    '[data-book-next]': next, '#booking-name': name, '#booking-phone': phone, 'select[name="players"]': players,
    '[data-date="2030-01-13"]': date, '[data-slot="3"]': slotBtn,
    '.devtools-guard-screen': o.guard ? el({}) : null,
  };
  class HTMLInputElement {} class HTMLSelectElement {} class HTMLTextAreaElement {}
  for (const C of [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement]) Object.defineProperty(C.prototype, 'value', { set(v) { this._v = v; }, configurable: true });
  // setV 는 프로토타입 setter 를 부른다 → 가짜 요소의 value 에 그대로 반영
  const proxySetter = (C) => Object.defineProperty(C.prototype, 'value', { set(v) { this.value = v; }, configurable: true });
  [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement].forEach(proxySetter);
  const window = {};
  const ctx = vm.createContext({
    window, location: { hostname: o.host || 'page-today.co.kr' }, performance: { now: () => Date.now() },
    setTimeout, Promise, Event: class { constructor(t) { this.type = t; } }, Date, Object, Array, String, Number, RegExp, JSON, Math,
    HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement,
    document: {
      querySelector: (s) => (s in map ? map[s] : null),
      querySelectorAll: (s) => (s === '[data-select-theme]' ? [theme] : s === '[aria-invalid="true"]' ? [] : []),
    },
  });
  if (o.picked) window.__PTD_PICKED = 1;
  return { clicks, st, name, phone, players, run: (want) => vm.runInContext(`(${ptdPick.toString()})(${JSON.stringify(want)})`, ctx) };
}
const PWANT = { title: '버디', date: '2030-01-13', slot: '3', time: '09:40', players: '3', name: '김토끼', phone: '01012345678' };

test("오늘의 한 페이지: 확인 화면까지 가고 '예약 확정' 은 누르지 않는다", async () => {
  const f = ptdCtx();
  const r = await f.run(PWANT);
  assert.equal(r.ok, true, r.problems.join(','));
  assert.equal(r.step, 'confirm');
  assert.deepEqual(f.clicks, { next: 2, confirm: 0, theme: 1, date: 1, slot: 1 });
  assert.equal(f.st.page, 3);
  assert.deepEqual([f.name.value, f.phone.value, f.players.value], ['김토끼', '010-1234-5678', '3']);
});

test('오늘의 한 페이지: 미리보기·감지 화면·중복·매진·확인 화면 미도착에서는 멈춘다', async () => {
  const pv = ptdCtx(); const r0 = await pv.run({ ...PWANT, preview: true });
  assert.equal(r0.ok, true); assert.equal(pv.clicks.theme, 0);
  const g = ptdCtx({ guard: true }); assert.match((await g.run(PWANT)).problems.join('|'), /감지 화면/); assert.equal(g.clicks.theme, 0);
  const d = ptdCtx({ picked: true }); assert.match((await d.run(PWANT)).problems.join('|'), /이미 진행/);
  const s = ptdCtx({ slotLabel: '09:40 매진' }); const rs = await s.run(PWANT);
  assert.equal(rs.ok, false); assert.equal(rs.step, 'slot'); assert.equal(s.clicks.next, 0);
  const sold = ptdCtx({ dateAttrs: { 'data-date-sold-out': '' } }); assert.match((await sold.run(PWANT)).problems.join('|'), /매진/);
  const w = ptdCtx({ title: '용팔도령' }); assert.match((await w.run(PWANT)).problems.join('|'), /테마 버튼 0개/);
  const stuck = ptdCtx({ stuckOnPage2: true }); const rk = await stuck.run(PWANT);
  assert.equal(rk.ok, false); assert.equal(stuck.clicks.confirm, 0);
});

/* ---------------- 오아시스 뮤지엄 ---------------- */
const OAS_HTML = `
<form method="post" class="user" id="ticket_form" name="ticket_form" action="/ticket/payment">
<input type="text" class="form-control" id="res_date" name="res_date" value="2030-01-07" readonly>
<select class="form-control" id="res_tm" name="res_tm"><option value="" selected>테마 선택</option><option value="1">업사이드 다운</option><option value="6">배드 타임 (BÆD TIME)</option></select>
<span id="tm_name1">[오아시스 뮤지엄 홍대]업사이드 다운</span>
<button id="sd_btn1_56" style="w" data-tm="1" data-date="" data-time="09:50" data-discount="5000" value="56" class="room_btn room_btn1 btn">09:50</button>
<button id="sd_btn1_57" data-tm="1" data-date="" data-time="11:30" data-discount="" value="57" class="room_btn room_btn1 btn">11:30</button>
<button id="sd_btn6_214" data-tm="6" data-date="" data-time="10:00" data-discount="2000" value="214" class="room_btn room_btn6 btn">10:00</button>
</form>
<script>price_info["1"] = {}; price_info["1"]["2"] = 58000; price_info["1"]["3"] = 87000; price_info["6"] = {}; price_info["6"]["3"] = 96000;</script>`;

test('오아시스: 테마·전체 이름·요금표·날짜별 회차 번호를 읽고, 창 밖 alert 응답을 구분한다', () => {
  assert.equal(isOasPage(OAS_HTML), true);
  assert.equal(isOasPage("<script type='text/javascript'>alert('예약할 수 없는 날짜입니다.');history.back();</script>"), false);
  const p = parseOasPage(OAS_HTML);
  assert.equal(p.date, '2030-01-07');
  assert.deepEqual(p.themes.map((t) => [t.theme, t.name]), [[1, '업사이드 다운'], [6, '배드 타임 (BÆD TIME)']]);
  assert.equal(p.themes[0].full, '[오아시스 뮤지엄 홍대]업사이드 다운');
  assert.deepEqual(p.themes[0].prices, { 2: 58000, 3: 87000 });
  assert.deepEqual(p.buttons.map((b) => [b.theme, b.num, b.time, b.discount]), [[1, 56, '09:50', 5000], [1, 57, '11:30', 0], [6, 214, '10:00', 2000]]);
});

test('오아시스: 마감 목록(getSchedule) 에 있는 회차는 닫힘, 창 밖 날짜는 notOpen', async () => {
  const real = globalThis.fetch;
  const calls = [];
  let page = OAS_HTML;
  globalThis.fetch = async (url, opt = {}) => {
    calls.push([String(url).replace(/^https:\/\/oasismuseum\.com/, ''), opt.body || '']);
    if (/getSchedule/.test(url)) return { ok: true, status: 200, text: async () => (/tm=1/.test(opt.body) ? '["57","57"]' : 'null') };
    return { ok: true, status: 200, text: async () => page };
  };
  try {
    const r = await oasTimes({ theme: 1, date: '2030-01-07' });
    assert.deepEqual(r.slots.map((s) => [s.time, s.num, s.open]), [['09:50', 56, true], ['11:30', 57, false]]);
    assert.deepEqual(calls.map((c) => c[0]), ['/ticket?date=2030-01-07&id=1', '/ticket/getSchedule']);
    assert.equal(calls[1][1], 'tm=1&date=2030-01-07');
    page = "<script>alert('예약할 수 없는 날짜입니다.');history.back();</script>";
    const out = await oasTimes({ theme: 1, date: '2030-01-14' });
    assert.equal(out.notOpen, true);
    assert.equal(out.slots.length, 0);
  } finally { globalThis.fetch = real; }
});

function oasCtx(o = {}) {
  const clicks = { slot: 0, submit: 0, agree: 0 };
  const btn = o.noBtn ? null : {
    attrs: { 'data-tm': '1', 'data-time': o.time || '09:50' }, className: o.cls || 'room_btn room_btn1 btn btn-opened',
    disabled: !!o.disabled, offsetParent: o.hidden ? null : {}, getAttribute(k) { return this.attrs[k]; }, click() { clicks.slot++; },
  };
  const window = { jQuery: o.noJq ? undefined : () => {} };
  if (o.picked) window.__OAS_PICKED = 1;
  const ctx = vm.createContext({
    window, location: { pathname: o.path || '/ticket' },
    document: { querySelector: (s) => (s === '#sd_btn1_56' ? btn : s === '#res_date' ? { value: o.date || '2030-01-07' } : null) },
  });
  return { clicks, run: (want) => vm.runInContext(`(${oasPick.toString()})(${JSON.stringify(want)})`, ctx) };
}
const OWANT = { theme: 1, num: 56, time: '09:50', date: '2030-01-07' };

test('오아시스: 시간 버튼은 좌표·열림·보임·jQuery·첫 클릭일 때만 1회 누른다', () => {
  const f = oasCtx();
  const r = f.run(OWANT);
  assert.equal(r.ok, true, r.problems.join(','));
  assert.equal(f.clicks.slot, 1);
  const p = oasCtx(); assert.equal(p.run({ ...OWANT, preview: true }).ok, false); assert.equal(p.clicks.slot, 0);
  const cases = [
    [{ time: '11:30' }, /시각 불일치/], [{ disabled: true }, /마감된 회차/], [{ cls: 'room_btn btn-closed' }, /마감된 회차/],
    [{ cls: 'room_btn' }, /btn-opened/], [{ hidden: true }, /안 보임/], [{ noJq: true }, /jQuery 없음/],
    [{ picked: true }, /이미 클릭/], [{ date: '2030-01-08' }, /화면 날짜/], [{ path: '/ticket/payment' }, /예약 화면이 아님/], [{ noBtn: true }, /시간 버튼 없음/],
  ];
  for (const [o, re] of cases) {
    const g = oasCtx(o);
    assert.match(g.run(OWANT).problems.join('|'), re);
    assert.equal(g.clicks.slot, 0);
  }
});

test("오아시스: 정보 입력기는 이름·연락처·인원·동의만 채우고 '예약하기' 는 누르지 않는다", async () => {
  let submit = 0;
  const field = (v = '') => ({ value: v, tagName: 'INPUT', dispatchEvent() {} });
  const els = {
    '#step2': { offsetParent: {} }, '#f_sd_n': { value: '56' }, '#f_tm': { value: '1' }, '#f_sd_time': { value: '09:50' }, '#f_date': { value: '2030-01-07' },
    '#f_name': field(), '#f_tel': field(),
    '#f_person': { tagName: 'SELECT', value: '2', options: [{ value: '2' }, { value: '3' }], dispatchEvent() {} },
    '#f_agree': { checked: false, click() { this.checked = true; } }, '#v_price': { textContent: '106,000 원' },
    '#f_submit': { click() { submit++; } },
  };
  class HTMLInputElement {} class HTMLSelectElement {}
  for (const C of [HTMLInputElement, HTMLSelectElement]) Object.defineProperty(C.prototype, 'value', { set(v) { this.value = v; }, configurable: true });
  const window = {};
  const ctx = vm.createContext({ window, performance: { now: () => 0 }, setTimeout, Promise, Date, Object, Array, String, Event: class {}, HTMLInputElement, HTMLSelectElement,
    document: { querySelector: (s) => els[s] || null } });
  const r = await vm.runInContext(`(${oasFiller.toString()})(${JSON.stringify({ name: '김토끼', phone: '01012345678', people: '3' })})`, ctx);
  assert.equal(r.state, 'done', (r.missing || []).join(','));
  assert.deepEqual([els['#f_name'].value, els['#f_tel'].value, els['#f_person'].value, els['#f_agree'].checked], ['김토끼', '010-1234-5678', '3', true]);
  assert.deepEqual({ ...r.hidden }, { tm: '1', sd_n: '56', time: '09:50', date: '2030-01-07' });   // vm 컨텍스트 객체라 펼쳐서 비교
  assert.equal(submit, 0);
});

/* ---------------- 최종 버튼 게이트 (--final-submit 전용) ---------------- */
function ptdSubmitCtx(o = {}) {
  const next = { innerText: o.label || '예약 확정', disabled: !!o.disabled, clicks: 0, click() { this.clicks++; }, getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  const summary = { innerText: o.summary || '예약 내용 확인 날짜와 시간 2030-01-13 09:40 이야기와 인원 버디 3명 예약자 김토끼 010-1234-5678 남긴 메모 없음' };
  const window = o.submitted ? { __PTD_SUBMITTED: 1 } : {};
  const ctx = vm.createContext({ window, document: {
    querySelector: (s) => (s === '[data-book-next]' ? next : s === '[data-book-page="3"]' ? summary : s === '.devtools-guard-screen' && o.guard ? {} : null),
    querySelectorAll: (s) => (s === '[aria-invalid="true"]' && o.invalid ? [{ name: 'phone' }] : []),
  } });
  return { next, run: (x) => vm.runInContext(`(${ptdSubmit.toString()})(${JSON.stringify(x)})`, ctx) };
}
const PSUB = { date: '2030-01-13', time: '09:40', title: '버디', name: '김토끼', phone: '01012345678', players: '3' };

test("오늘의 한 페이지 최종: 확인 화면 요약이 목표와 맞을 때만 '예약 확정' 1회", () => {
  const f = ptdSubmitCtx(); const r = f.run(PSUB);
  assert.equal(r.ok, true, r.problems.join(',')); assert.equal(f.next.clicks, 1);
  const p = ptdSubmitCtx(); p.run({ ...PSUB, preview: true }); assert.equal(p.next.clicks, 0);
  const cases = [
    [{ label: '다음 페이지' }, /확정 버튼 라벨/], [{ disabled: true }, /비활성/], [{ guard: true }, /감지 화면/], [{ invalid: true }, /입력 오류/],
    [{ submitted: true }, /이미 예약 확정/], [{ summary: '2030-01-13 10:45 버디 3명 김토끼 010-1234-5678' }, /시각 없음/],
    [{ summary: '2030-01-13 09:40 버디 2명 김토끼 010-1234-5678' }, /인원 없음/], [{ summary: '2030-01-13 09:40 버디 3명 김토끼 010-9999-0000' }, /연락처 없음/],
  ];
  for (const [o, re] of cases) { const g = ptdSubmitCtx(o); assert.match(g.run(PSUB).problems.join('|'), re); assert.equal(g.next.clicks, 0); }
});

function oasSubmitCtx(o = {}) {
  const v = { '#f_tm': '1', '#f_sd_n': '56', '#f_sd_time': '09:50', '#f_date': '2030-01-07', '#f_name': '김토끼', '#f_tel': '010-1234-5678', '#f_person': '3', '#f_price': '87000', ...(o.values || {}) };
  const btn = { disabled: false, clicks: 0, click() { this.clicks++; } };
  const els = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { value: x }]));
  els['#step2'] = { offsetParent: o.hidden ? null : {} };
  els['#f_agree'] = { checked: o.agree !== false };
  els['#v_price'] = { textContent: '87,000 원' };
  const window = o.submitted ? { __OAS_SUBMITTED: 1 } : {};
  const ctx = vm.createContext({ window, location: { pathname: o.path || '/ticket' }, document: {
    querySelector: (s) => els[s] || null, querySelectorAll: (s) => (s === '#f_submit' ? (o.noBtn ? [] : [btn]) : []),
  } });
  return { btn, run: (x) => vm.runInContext(`(${oasSubmit.toString()})(${JSON.stringify(x)})`, ctx) };
}
const OSUB = { want: { tm: '1', sd_n: '56', time: '09:50', date: '2030-01-07' }, name: '김토끼', phone: '01012345678', people: '3' };

test("오아시스 최종: 좌표·이름·연락처·인원·금액·동의가 맞을 때만 '예약하기' 1회", () => {
  const f = oasSubmitCtx(); const r = f.run(OSUB);
  assert.equal(r.ok, true, r.problems.join(',')); assert.equal(f.btn.clicks, 1);
  const p = oasSubmitCtx(); p.run({ ...OSUB, preview: true }); assert.equal(p.btn.clicks, 0);
  const cases = [
    [{ values: { '#f_sd_n': '57' } }, /좌표 sd_n/], [{ values: { '#f_date': '2030-01-08' } }, /좌표 date/], [{ values: { '#f_name': '다른' } }, /이름 불일치/],
    [{ values: { '#f_tel': '010-0000-0000' } }, /연락처 불일치/], [{ values: { '#f_person': '2' } }, /인원 2≠3/], [{ values: { '#f_price': '' } }, /금액 없음/],
    [{ agree: false }, /동의 미체크/], [{ hidden: true }, /정보 입력 화면이 아님/], [{ noBtn: true }, /버튼 0개/], [{ submitted: true }, /이미 예약하기/], [{ path: '/ticket/payment' }, /예약 화면이 아님/],
  ];
  for (const [o, re] of cases) { const g = oasSubmitCtx(o); assert.match(g.run(OSUB).problems.join('|'), re); assert.equal(g.btn.clicks, 0); }
});
