import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { naverProduct, parseNaverProduct, naverPreview, naverOpenInfo, validateNaverRun, driveNaver, validNaverDate } from '../naver.mjs';
import { naverPage } from '../naver-browser.mjs';

const product = naverProduct('843881', '6627331');
test('registry selects the exact Naver business and theme; rejects arbitrary hosts and duplicate coordinates', () => {
  assert.equal(product.name, '바야흐로,여름이었다.');
  assert.throws(() => naverProduct('843881', '1'));
  assert.throws(() => parseNaverProduct({ ...product, url: 'https://example.com/booking/12/bizes/843881/items/6627331' }));
});
test('weekday schedules distinguish Wednesday 19:20 from Friday 19:10, without claiming availability', () => {
  const wed = naverPreview('843881', '6627331', '2026-09-16');
  const fri = naverPreview('843881', '6627331', '2026-09-18');
  assert.ok(wed.slots.some(s => s.time === '19:20'));
  assert.ok(!wed.slots.some(s => s.time === '19:10'));
  assert.ok(fri.slots.some(s => s.time === '19:10'));
  assert.ok(wed.preview && wed.slots.every(s => !s.open));
});
test('calendar window opens September 16 at September 10 midnight KST', () => {
  assert.equal(naverOpenInfo('843881', '6627331', '2026-09-16').openAt, '2026-09-10T00:00:00+09:00');
  assert.equal(validNaverDate('2026-02-30'), false);
  assert.throws(() => naverPreview('843881', '6627331', 'not-a-date'));
});
test('dry run needs no selected time; wrong time and malformed dates are rejected', () => {
  assert.equal(validateNaverRun({ zizum: '843881', theme: '6627331', date: '2030-09-16', dry: true }).time, '');
  assert.throws(() => validateNaverRun({ zizum: '843881', theme: '6627331', date: '2030-09-16', times: '25:00' }));
});
function browser({ locked = false, selected = true, stale = false, login = true, rateLimit = false } = {}) {
  const date = '2026-09-16', time = '19:20', clicks = { date: 0, time: 0, next: 0 };
  const button = (text, cls, attrs, click) => ({ textContent: text, className: cls, disabled: false,
    getClientRects: () => [1], getAttribute: n => attrs[n] ?? null,
    classList: { contains: c => cls.split(' ').includes(c) }, click });
  const days = Array.from({ length: 35 }, (_, i) => button(String(i), i === 17 && locked ? 'unselectable selected' : '', {
    'aria-selected': i === 17 ? 'true' : 'false', 'aria-disabled': i === 17 ? 'false' : 'true',
  }, () => { clicks.date++; }));
  const slot = button('오후 7:20', '', { 'aria-selected': selected ? 'true' : 'false' }, () => { clicks.time++; });
  const next = button('다음', '', {}, () => { clicks.next++; });
  const cal = { getClientRects: () => [1], querySelector: s => s === '.calendar_title' ? { textContent: '2026.9' } : null,
    querySelectorAll: () => days };
  const key = 'schedule(' + JSON.stringify({ input: { bizItemId: product.theme, businessId: product.business, startDateTime: date + 'T00:00:00', endDateTime: date + 'T23:59:59' } }) + ')';
  const context = vm.createContext({ URL, location: { href: product.url }, window: { __APOLLO_STATE__: { ROOT_QUERY: { [key]: { bizItemSchedule: { hourly: [] } } } } }, document: {
    title: product.name, body: { innerText: rateLimit ? '요청이 너무 많습니다' : stale ? '9. 15(화)' : '9. 16(수)' },
    querySelectorAll: s => s === '.calendar_month' ? [cal] : s === '.time_list .btn_time' ? [slot]
      : s === 'a,button' ? (login ? [button('로그아웃', '', {}, () => {})] : []) : [next],
  } });
  return { clicks, read: action => vm.runInContext(`(${naverPage.toString()})(${JSON.stringify({ product, date, time, action })})`, context) };
}
test('locked + selected date never exposes slots or clicks a next button', () => {
  const b = browser({ locked: true });
  assert.equal(b.read('read').loaded, false);
  assert.equal(b.read('next').ok, false);
  b.read('date'); assert.deepEqual(b.clicks, { date: 0, time: 0, next: 0 });
});
test('stale date header and logged-out state prevent proceeding', () => {
  const stale = browser({ stale: true }); assert.equal(stale.read('next').ok, false);
  const out = browser({ login: false }); assert.equal(out.read('next').ok, false);
});
test('time selection must be reflected before next; next clicks at most once', () => {
  const pending = browser({ selected: false }); assert.equal(pending.read('next').ok, false);
  const b = browser(); assert.equal(b.read('next').clicked, true); assert.equal(b.read('next').ok, false);
  assert.equal(b.clicks.next, 1);
});
test('rate-limit screen blocks normal retry flow', () => { assert.equal(browser({ rateLimit: true }).read('read').blocked, true); });
function driver(read, options = {}) {
  let clock = 0, refreshes = 0;
  return { run: () => driveNaver({ read, refresh: async () => { refreshes++; }, focus: async () => {}, deadline: 2000,
    now: () => clock, nap: async ms => { clock += ms; }, log: () => {}, ...options }), refreshes: () => refreshes };
}
test('scheduler retries reversible selections until hydration reflects them, then confirms arrival', async () => {
  let dates = 0, times = 0, next = 0;
  const d = driver(async action => {
    if (action === 'date') { dates++; return {}; }
    if (action === 'time') { times++; return {}; }
    if (action === 'next') { next++; return { clicked: true }; }
    return next ? { request: true } : { loaded: dates >= 2, loggedIn: true, wantTime: '19:20', slots: [{ time: '19:20', open: true, selected: times >= 2 }] };
  });
  assert.equal(await d.run(), 'request'); assert.equal(dates, 2); assert.equal(times, 2); assert.equal(next, 1);
});
test('scheduler never repeats next or refreshes while arrival is uncertain', async () => {
  let next = 0;
  const d = driver(async a => a === 'next' ? (next++, { clicked: true }) : { loaded: true, loggedIn: true, wantTime: '19:20', slots: [{ time: '19:20', open: true, selected: true }] });
  await assert.rejects(d.run(), /중복 클릭하지 않고/); assert.equal(next, 1); assert.equal(d.refreshes(), 0);
});
test('manual mode hands off without selecting a time or proceeding', async () => {
  const actions = [];
  const d = driver(async a => { actions.push(a); return { loaded: true, wantTime: '19:20', slots: [{ time: '19:20', open: true }] }; }, { auto: false });
  assert.equal(await d.run(), 'manual'); assert.deepEqual(actions, ['read']);
});
test('scheduler immediately stops on access restriction', async () => {
  const d = driver(async () => ({ blocked: true, msg: '요청 제한' }));
  await assert.rejects(d.run(), /요청 제한/); assert.equal(d.refreshes(), 0);
});
