/**
 * 방탈출 토끼굴(rhe) 어댑터 테스트 — 오프라인으로 돈다 (네트워크/브라우저 불필요).
 *   · fixture-rhe-reservation.html : 예약 화면(지점·테마·날짜 select + 시간 버튼 + eveSubmitForm) 실측 구조
 *   · fixture-rhe-create.html      : 시간 버튼 클릭 후의 신청서(이름/연락처/인원/결제/약관 + hidden 좌표)
 * 브라우저 쪽 함수(rhePick/rheFiller) 는 recaptcha-click-test.mjs 처럼 vm 가짜 DOM 에서 돌려서
 * '목적지 폼' 게이트와 '최종 예약하기는 절대 누르지 않는다' 는 정책을 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { RHE, rheUrl, isRhePage, rheOptions, parseRhePage, rhePick, rheFiller, rheCreateRead, rheNoteWindow, rheOpenInfo, rheToday, rheHtml, rheTimes } from '../rhe.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const RES = await readFile(path.join(dir, 'fixture-rhe-reservation.html'), 'utf8');
const CREATE = await readFile(path.join(dir, 'fixture-rhe-create.html'), 'utf8');
const DAY = 86400000;
const plusDays = (base, n) => new Date(Date.parse(base + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/* ---------------- 예약 화면 파싱 ---------------- */
test('예약 화면: 지점·테마·기준일과 테마 정보를 읽는다', () => {
  assert.equal(isRhePage(RES), true);
  assert.equal(isRhePage('<html><body>홈 화면입니다</body></html>'), false);
  assert.match(rheUrl({ branch: 1, theme: 5, date: '2030-01-07' }), /\/reservation\?branch=1&theme=5&date=2030-01-07$/);

  const p = parseRhePage(RES);
  assert.equal(p.today, '2030-01-07');                        // <input name="date" value> = 서버 기준일
  assert.deepEqual(p.branches.map((b) => b.value), ['1']);     // 지점 1개 = 홍대점
  assert.deepEqual(p.themes.map((t) => t.value), ['5', '4']);   // '' (전체) 는 드롭다운에서 버린다
  assert.equal(p.sections.length, 2);
  assert.deepEqual(
    p.sections.map((s) => [s.name, s.info['인원'], s.info['시간'], s.level]),
    [['행운만물상', '2~4', '70min', '4'], ['두껍아 두껍아 헌집줄게 새집다오', '2~6', '75min', '3']]);
  assert.equal(rheOptions(RES, 'theme').filter((o) => !o.value).length, 1);   // '전체' 한 개
});

test('예약 화면: 가능/불가 슬롯을 구분하고 예약좌표(hiddenData)를 복원한다', () => {
  const p = parseRhePage(RES);
  const [first, second] = p.sections;
  assert.deepEqual(first.slots.map((s) => [s.time, s.open]), [['11:20', true], ['12:50', false], ['14:20', true]]);
  assert.equal(first.slots[0].data.date, '2030-01-07');   // &quot; 로 온 JSON 이 바로 파싱돼야 한다
  assert.equal(first.slots[0].data.theme, 5);
  assert.equal(first.slots[1].data, null);                // '예약불가' 버튼에는 hiddenData 가 없다
  assert.equal(first.slots.filter((s) => s.open).length, 2);
  assert.equal(second.slots.filter((s) => s.open).length, 1);
  assert.equal(second.slots[0].data.theme, 4);
});

test('신청서 픽스처: 예약좌표 hidden · 입력란 · 최종 버튼의 자리', () => {
  assert.match(CREATE, /action="https:\/\/www\.rabbitholeescape\.co\.kr\/reservation\/create"/);
  for (const n of ['name', 'phone', 'people', 'policy', 'payment_method', 'branch', 'theme', 'date', 'time']) assert.match(CREATE, new RegExp(`name="${n}"`));
  assert.match(CREATE, /id="eveReservationBtn"[^>]*>예약하기</);   // 사람이 누르는 버튼 (자동 클릭 금지 대상)
  assert.match(CREATE, /id="hiddenData"/);                         // 요금표
});


/* ---------------- 세션 쿠키 (가짜 fetch — 네트워크 없음) ---------------- */
test('세션 쿠키: 같은 이름은 덮어써 헤더가 커지지 않고, 4xx 는 창 밖으로 오인하지 않는다', async () => {
  const real = globalThis.fetch;
  const sent = [];
  let status = 200;
  globalThis.fetch = async (url, opt) => {
    const n = sent.push(opt.headers.cookie || '');
    const cookies = [`XSRF-TOKEN=x${n}; path=/`, `rabbit_session=s${n}; path=/; httponly`];
    return { status, headers: { getSetCookie: () => cookies, get: () => '' }, text: async () => RES };
  };
  try {
    for (let i = 0; i < 20; i++) assert.equal(isRhePage(await rheHtml({ date: '2030-01-07' })), true);
    assert.equal(sent.at(-1), 'XSRF-TOKEN=x19; rabbit_session=s19');   // 예전엔 40쌍이 덧붙어 8KB 를 넘었다
    status = 400;
    const r = await rheTimes({ date: '2030-01-07' });
    assert.equal(r.ok, false);
    assert.notEqual(r.notOpen, true);
    assert.match(r.msg, /HTTP 400/);
  } finally { globalThis.fetch = real; }
});

test('오픈 대기 폴링: 살아 있는 세션으로 튕기면 창 밖으로 보고 요청 1회로 끝낸다', async () => {
  const real = globalThis.fetch;
  let calls = 0, mode = 'page';
  globalThis.fetch = async () => {
    calls++;
    const headers = { getSetCookie: () => ['XSRF-TOKEN=t; path=/', 'rabbit_session=s; path=/'], get: () => (mode === 'page' ? '' : RHE.base) };
    return mode === 'page'
      ? { status: 200, headers, text: async () => RES }
      : { status: 302, headers, text: async () => '' };
  };
  try {
    assert.equal((await rheTimes({ date: '2030-01-07' })).total > 0, true);   // 세션 확보
    mode = 'redirect'; calls = 0;
    const r = await rheTimes({ date: '2030-01-14' });
    assert.equal(r.notOpen, true);
    assert.equal(calls, 1);                                                   // 예전엔 warm + 재시도로 3회
    mode = 'page'; calls = 0;
    assert.equal((await rheTimes({ date: '2030-01-07' })).notOpen, false);    // 창이 열리면 바로 첫 요청에 잡힌다
    assert.equal(calls, 1);
  } finally { globalThis.fetch = real; }
});

/* ---------------- rhePick: 시간 버튼 게이트 ---------------- */
const coord = (o = {}) => ({ branch: 1, theme: 5, date: '2030-01-07', time: '11:20', ...o });
const slotBtn = (data, { active = true, label = '예약가능', time = '11:20', visible = true } = {}) => ({
  className: 'eveReservationButton' + (active ? ' active1' : ''), innerText: `${label} ${time}`,
  offsetParent: visible ? {} : null, clicks: 0,
  click() { this.clicks++; },
  querySelector: (s) => s === '.eveHiddenData' ? (data ? { textContent: JSON.stringify(data) } : null)
    : s === 'label' ? { textContent: label } : s === 'span' ? { textContent: time } : null,
});
function pickCtx(o = {}) {
  const buttons = o.buttons || [slotBtn(coord())];
  const form = o.noForm ? null : { querySelector: (s) => (s === '[name="_token"]' ? { value: o.noToken ? '' : 'FIXTURE-CSRF-TOKEN' } : null) };
  const ctx = vm.createContext({
    document: {
      querySelectorAll: (s) => (s === '.eveReservationButton' ? buttons : []),
      querySelector: (s) => s === '#eveSubmitForm' ? form
        : s === 'input[name="date"]' ? { value: o.dateInput === undefined ? '2030-01-07' : o.dateInput } : null,
    },
    location: { pathname: o.pathname || '/reservation', href: 'https://x' + (o.pathname || '/reservation') },
    window: o.picked ? { __RHE_PICKED: 123 } : {},
  });
  return { run: (opt) => vm.runInContext(`(${rhePick.toString()})(${JSON.stringify(opt)})`, ctx), buttons };
}
const WANT = { branch: 1, theme: 5, date: '2030-01-07', time: '11:20' };

test('시간 버튼: 좌표 4개가 모두 맞아야 한 번만 누른다', () => {
  const f = pickCtx();
  const r = f.run(WANT);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.problems], []);
  assert.equal(r.btn, '예약가능 11:20');
  assert.equal(f.buttons[0].clicks, 1);
  assert.match(r.좌표, /^1\/5\/2030-01-07\/11:20$/);
});

test('시간 버튼: preview 는 판단 근거만 돌려주고 클릭하지 않는다', () => {
  const f = pickCtx();
  assert.equal(f.run({ ...WANT, preview: true }).ok, false);
  assert.equal(f.buttons[0].clicks, 0);
});

test('시간 버튼: 좌표 불일치·불가·중복·화면 밖에서는 클릭하지 않는다', () => {
  const cases = [
    [{ buttons: [slotBtn(coord({ time: '14:20' }))] }, /목표 시간 버튼 0개/],
    [{ buttons: [slotBtn(null)] }, /목표 시간 버튼 0개/],                    // '예약불가' 는 hiddenData 도 없다
    [{ buttons: [slotBtn(coord(), { active: false })] }, /active1 아님/],
    [{ buttons: [slotBtn(coord(), { label: '예약불가' })] }, /라벨이 '예약가능' 아님/],
    [{ buttons: [slotBtn(coord()), slotBtn(coord())] }, /목표 시간 버튼 2개/],
    [{ buttons: [slotBtn(coord(), { visible: false })] }, /목표 시간 버튼 0개/],
    [{ buttons: [slotBtn(coord({ theme: 4 }))], pathname: '/reservation/create' }, /예약 화면이 아님/],
  ];
  for (const [o, re] of cases) {
    const f = pickCtx(o);
    assert.match(f.run(WANT).problems.join('|'), re);
    assert.equal(f.buttons.reduce((a, b) => a + b.clicks, 0), 0);
  }
});

test('시간 버튼: 폼·토큰·화면 날짜·중복클릭 게이트', () => {
  assert.match(pickCtx({ noForm: true }).run(WANT).problems.join('|'), /#eveSubmitForm 없음/);
  assert.match(pickCtx({ noToken: true }).run(WANT).problems.join('|'), /_token 비어있음/);
  assert.match(pickCtx({ dateInput: '2030-01-08' }).run(WANT).problems.join('|'), /화면 날짜 2030-01-08≠2030-01-07/);
  const f = pickCtx({ picked: true });
  assert.match(f.run(WANT).problems.join('|'), /이미 클릭한 회차/);
  assert.equal(f.buttons[0].clicks, 0);
});

/* ---------------- rheFiller: 신청서 입력기 ---------------- */
class HTMLInputElement { constructor() { this._v = ''; } get value() { return this._v; } set value(v) { this._v = String(v); } }
class HTMLSelectElement { constructor() { this._v = ''; } get value() { return this._v; } set value(v) { this._v = String(v); } }
class FakeEvent { constructor(type) { this.type = type; } }

function fillCtx(o = {}) {
  const field = (tag, name, value) => {
    const el = tag === 'SELECT' ? new HTMLSelectElement() : new HTMLInputElement();
    el.tagName = tag; el.name = name; el._v = value || ''; el.events = [];
    el.dispatchEvent = (e) => { el.events.push(e.type); };
    return el;
  };
  const name = field('INPUT', 'name'), phone = field('INPUT', 'phone');
  const people = field('SELECT', 'people');
  people.options = [{ value: '' }, { value: '2' }, { value: '3' }, { value: '4' }];
  const policy = { checked: false, clicks: 0, click() { this.clicks++; this.checked = true; } };
  const pays = (o.pays || ['21']).map((v) => ({ value: v, checked: false, clicks: 0, click() { this.clicks++; this.checked = true; } }));
  const hidden = { branch: '1', theme: '5', date: '2030-01-07', time: '11:20' };
  const table = { innerText: '예약일 30년 01월 07일 / 11시 20분 테마명 행운만물상 결제비용 144,000원' };
  const btn = { textContent: '예약하기', clicks: 0, click() { this.clicks++; } };
  const price = { textContent: '144,000원' };
  const map = {
    name, phone, people, policy,
    branch: field('INPUT', 'branch', hidden.branch), theme: field('INPUT', 'theme', hidden.theme),
    date: field('INPUT', 'date', hidden.date), time: field('INPUT', 'time', hidden.time),
  };
  const form = {
    querySelector: (s) => map[(s.match(/\[name="(\w+)"\]/) || [])[1]] || null,
    querySelectorAll: (s) => (/payment_method/.test(s) ? pays : []),
  };
  name.form = o.noForm ? null : form;
  let now = 0;
  const timers = [];
  const ctx = vm.createContext({
    performance: { now: () => (now += o.jump || 0) }, setTimeout: (fn, ms) => { timers.push(ms); return 0; },
    Event: FakeEvent, HTMLInputElement, HTMLSelectElement,
    location: { pathname: o.pathname || '/reservation/create', href: 'https://x' + (o.pathname || '/reservation/create') },
    document: {
      querySelector: (s) => (/reservation\/create/.test(s) || s === 'input[name="name"]') ? (o.noForm ? null : name)
        : s === '#evePrice' ? price : s === '#eveReservationBtn' ? btn : s === '.reservation-form-table' ? table : null,
      body: { innerText: '예약하기' },
    },
    window: {},
  });
  const run = (want) => { vm.runInContext(`(${rheFiller.toString()})(${JSON.stringify(want)})`, ctx); return ctx.window.__RHE_FILL; };
  return { run, ctx, name, phone, people, policy, pays, btn, timers };
}

test('신청서 입력기: 이름·연락처(010-0000-0000)·인원·결제수단·약관을 채우고 요금을 확인한다', () => {
  const f = fillCtx();
  const st = f.run({ name: '김토끼', phone: '01012345678' });
  assert.equal(st.state, 'done');
  assert.deepEqual([...st.missing], []);
  assert.equal(f.name.value, '김토끼');
  assert.equal(f.phone.value, '010-1234-5678');       // 사이트 마스크 '00Z-000Z-0000' 에 맞춘다
  assert.equal(f.people.value, '2');                  // 인원 미선택 시 테마 최소 인원(첫 옵션)
  assert.deepEqual({ ...st.hidden }, { branch: '1', theme: '5', date: '2030-01-07', time: '11:20' });
  assert.equal(st.price, '144,000원');
  assert.equal(f.policy.checked, true);
  assert.equal(f.pays[0].checked, true);
  assert.deepEqual([...f.name.events], ['input', 'change']);   // 사이트 핸들러가 움직이도록 이벤트까지 보낸다
  assert.equal(f.btn.clicks, 0);                          // '예약하기'는 절대 누르지 않는다
});

test('신청서 입력기: 인원 지정은 옵션에 있을 때만, 결제수단이 여러 개면 사람이 고르게 둔다', () => {
  const f = fillCtx({ pays: ['21', '30'] });
  const st = f.run({ name: '김토끼', phone: '010-1234-5678', people: '4' });
  assert.equal(f.people.value, '4');
  assert.equal(st.state, 'partial');
  assert.match(st.missing.join(','), /payment_method\(선택지 2개/);
  assert.equal(f.pays[0].checked, false);
  const g = fillCtx();
  const g2 = g.run({ name: '김토끼', phone: '01012345678', people: '9' });   // 테마 인원(2~4) 에 없는 값은 고집하지 않고 사람이 고르게 둔다
  assert.equal(g.people.value, '');
  assert.equal(g2.state, 'partial');
  assert.match(g2.missing.join(','), /people/);
  assert.equal(g.btn.clicks, 0);
});

test('신청서 입력기: 예약 화면에서는 폼을 찾지 않고 대기만 한다', () => {
  assert.equal(fillCtx({ pathname: '/reservation' }).run({ name: '김토끼' }).state, 'not-create-page');
  const missing = fillCtx({ noForm: true });
  assert.equal(missing.run({ name: '김토끼' }), undefined);
  assert.deepEqual(missing.timers, [60]);              // 재시도 예약
  assert.equal(fillCtx({ noForm: true, jump: 30000 }).run({ name: '김토끼' }).state, 'err');
});

test('신청서 스냅샷: 입력 결과와 버튼 상태를 읽는다 (버튼은 읽기만)', () => {
  const f = fillCtx();
  f.run({ name: '김토끼', phone: '01012345678' });
  const r = vm.runInContext(`(${rheCreateRead.toString()})()`, f.ctx);
  assert.equal(r.onCreate, true);
  assert.equal(r.name, '김토끼');
  assert.equal(r.phone, '010-1234-5678');
  assert.equal(r.people, '2');
  assert.equal(r.policy, true);
  assert.equal(r.payOptions, '21');
  assert.equal(r.button, '예약하기');
  assert.equal(r.fillState, 'done');
  assert.deepEqual({ ...r.hidden }, { branch: '1', theme: '5', date: '2030-01-07', time: '11:20' });
  assert.equal(f.btn.clicks, 0);
});

/* ---------------- 오픈 규칙 (공지 없음 → 오늘~오늘+6 롤링 창) ---------------- */
test('오픈 정보: 공지 없는 사이트라 예약 창(오늘+6) 기준 자정으로 안내한다', async () => {
  const today = rheToday();
  const info = await rheOpenInfo({ date: plusDays(today, 20) });
  assert.equal(info.ok, true);
  assert.equal(info.openTime, '00:00');
  assert.equal(info.leadDays, 6);                       // 서버 실측 창 끝 (사이트 달력의 +7 은 서버가 302 로 거부)
  assert.equal(info.inWindow, false);
  assert.equal(info.openDate, plusDays(today, 14));     // 오늘+20 은 오늘+14 에 열리기 시작
  assert.match(info.openAt, /T00:00:00\+09:00$/);
  assert.match(info.openTimeSource, /공지 없음/);
  const inside = await rheOpenInfo({ date: plusDays(today, 2) });
  assert.equal(inside.inWindow, true);
  assert.equal(inside.past, true);                      // 창 안 날짜의 오픈 시각은 이미 지났다
  const past = await rheOpenInfo({ date: plusDays(today, -1) });
  assert.equal(past.past, true);
  assert.equal(past.ok, false);
  const none = await rheOpenInfo({});
  assert.equal(none.ok, false);
  assert.equal(none.branch, '홍대점');
  assert.equal(RHE.payMethod, '가상계좌');
});

test('오픈 정보: 날짜표를 훑어 관측한 창 끝을 다음 안내에 우선 반영한다', async () => {
  const today = rheToday();
  const rows = [3, 4, 5].map((n) => ({ date: plusDays(today, n), total: 6 })).concat([{ date: plusDays(today, 6), total: 0 }]);
  const noted = rheNoteWindow(today, rows);
  assert.equal(noted.windowEnd, plusDays(today, 5));
  assert.equal(rheNoteWindow(today, rows.map((r) => ({ ...r, total: 6 }))), null);   // 표 끝까지 창 안이면 단정하지 않는다
  assert.equal(rheNoteWindow(today, []), null);
  const info = await rheOpenInfo({ date: plusDays(today, 12) });
  assert.equal(info.leadDays, 5);
  assert.equal(info.windowEnd, plusDays(today, 5));
  assert.equal(info.inWindow, false);
  assert.match(info.leadSource, /달력 관측 창 끝/);
});

