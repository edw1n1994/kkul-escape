#!/usr/bin/env node
/**
 * 단편선(dpsnnn.com) 어댑터 검증 — 실제 사이트가 아니라 실측 HTML 조각/목업에서 돌린다.
 *
 *   node ui/tests/dps-test.mjs [--port 9222]
 *
 * ① 달력 파서 (fixture-dps-calendar.html = /booking/html_list.cm 실측 응답에서 잘어온 조각)
 *    · 완료(완) / 미오픈(예약불가) / 지난 날(예약 종료) 은 닫힘, 가(#8EC31F) 만 열림
 * ② 로그인 판정 우선순위 (알림 드로어 템플릿의 '로그아웃' 링크에 속으면 안 된다 — 실측 함정)
 * ③ 결제화면 입력기 (fixture-dps-payment.html) : 이름/연락처(3조각)/입금자명 + 무통장입금 선택, 결제 버튼 미클릭
 * ④ '예약하기' 게이트 (fixture-dps-slot.html) : 로그아웃·좌표불일치·버튼 2개·중복클릭 거부, 통과 시 1회
 */
import fs from 'node:fs';
import { cdp, sleep } from '../lib.mjs';
import {
  parseDpsDay, parseDpsLogin, dpsUrl, dpsFiller, dpsBook, dpsOrderRead, dpsSlotRead, dpsLoginRead,
} from '../dps.mjs';

const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1] || 9222);
const cal = fs.readFileSync(new URL('./fixture-dps-calendar.html', import.meta.url), 'utf8');
const PAY = new URL('./fixture-dps-payment.html', import.meta.url);
const SLOT = new URL('./fixture-dps-slot.html', import.meta.url);

let fail = 0, total = 0;
const t = async (name, cond, extra) => { total++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`); if (!cond) fail++; };

/* ---------- ① 달력 파서 ---------- */
const done = parseDpsDay(cal, '2026-09-10');
await t('완료된 날: 18개 슬롯을 읽고 전부 닫힘', done.ok && done.total === 18 && done.open === 0, `총${done.total} 가능${done.open}`);
await t('완료 슬롯의 좌표(href)를 복원한다', done.slots[0].num === 25 && done.slots[0].day === '20260910' && done.slots[0].time === '10:00', JSON.stringify(done.slots[0]).slice(0, 90));
await t('뱃지 완료(완) 상태를 그대로 보존', done.slots[0].badge === '완' && done.slots[0].color === '#fa565a', `${done.slots[0].badge}/${done.slots[0].color}`);
const closed = parseDpsDay(cal, '2026-09-16');
await t('미오픈 날(예약불가): 슬롯 0개 + notOpen', closed.ok && closed.total === 0 && closed.notOpen === true, closed.msg);
const past = parseDpsDay(cal, '2026-08-31');
await t('지난 날(예약 종료): past 판단', past.ok && past.past === true && past.total === 0, past.msg);
const opened = parseDpsDay(cal, '2026-09-15');
await t('예약가능(가) 셀: open=true 로 열림', opened.open === opened.total && opened.open > 0, `가능${opened.open}/${opened.total}`);
await t('open 슬롯은 클릭 가능한 슬롯 URL 을 만든다', dpsUrl(36, '2026-09-15').endsWith('/reserve_g?idx=36&day=20260915'), dpsUrl(36, '2026-09-15'));
await t('달력에 없는 날짜는 missing (지어내지 않음)', parseDpsDay(cal, '2027-01-01').missing === true);

/* ---------- ② 로그인 판정 ---------- */
await t('guest 문구가 있으면 로그아웃 (로그아웃 링크가 보여도)', parseDpsLogin({ guest: true, memberBlock: true }).loggedIn === false);
await t('guest 없고 회원 블록 있으면 로그인됨', parseDpsLogin({ guest: false, memberBlock: true, member: '테스트유저' }).loggedIn === true);
await t('회원 블록에 실명+이메일이 있어도 마스킹해서 노출', (() => {
  const m = parseDpsLogin({ guest: false, memberBlock: true, member: '테스트유저 test@example.com' }).msg;
  return !/테스트유저|example/.test(m) && /테\*\*\*/.test(m);
})(), parseDpsLogin({ guest: false, memberBlock: true, member: '테스트유저 test@example.com' }).msg);
await t('마커가 없으면 판단 보류(null)', parseDpsLogin({ guest: false, memberBlock: false }).loggedIn === null);
await t('IS_GUEST=false 는 로그인됨', parseDpsLogin({ guest: false, memberBlock: false, isGuestFlag: false }).loggedIn === true);

/* ---------- 브라우저가 필요한 부분 ---------- */
const open = async (url) => {
  const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => r.json());
  const c = cdp(tab.webSocketDebuggerUrl);
  await c.ready; await c.send('Runtime.enable'); await sleep(900);
  return { tab, c };
};
const close = (tab) => fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).then(() => {}).catch(() => {});

try {
  /* ---------- ③ 결제화면 입력기 (실측 구조: 라벨 없음, orderer_name · depositor_name) ---------- */
  const pay = await open(PAY.href);
  const WANT = { name: '테스트유저', hp: '010-1234-5678', dep: '테스트입금자' };
  await pay.c.evaluate(`(() => { window.__FILL_ERR = '이전 실행 잔존 오류'; })()`);   // 실측에서 결과를 오염시킨 그 잔존값
  const filled = await pay.c.evaluate(`(async () => {
    (${dpsFiller.toString()})(${JSON.stringify(WANT)});
    for (let i = 0; i < 120; i++) { if (window.__DPS_FILL && (window.__DPS_FILL.at || window.__DPS_FILL.err)) break; await new Promise((r) => setTimeout(r, 25)); }
    return (${dpsOrderRead.toString()})();
  })()`);
  await t('라벨이 없어도 확정 name 으로 이름/연락처/입금자명을 넣는다', Object.keys(filled.filled).length >= 3 && filled.fillErr === null, JSON.stringify(filled.filled) + ' err=' + filled.fillErr);
  await t('각 값이 올바른 필드(name) 에 들어갔다', /orderer_name/.test(filled.matched.name) && /orderer_call/.test(filled.matched.hp) && /depositor_name/.test(filled.matched.dep), JSON.stringify(filled.matched));
  await t('무통장입금(pay_type=cash) 라디오로 선택했다', filled.radios.some((r) => r.checked && /무통장/.test(r.label)), JSON.stringify(filled.radios.map((r) => r.label + (r.checked ? '*' : ''))));
  await t('연락처 한 줄 입력란에는 010-0000-0000 그대로', filled.filled.hp === WANT.hp, filled.filled.hp);
  await t('요청사항(deliv_memo) 은 건드리지 않는다', (filled.inputs.find((i) => /deliv_memo/.test(i.key)) || {}).val === '', JSON.stringify(filled.inputs.filter((i) => /deliv_memo/.test(i.key))));
  await t('약관 체크박스는 대신 체크하지 않는다', (await pay.c.evaluate("document.querySelector('[name=agree_cancel]').checked")) === false);
  await t('결제하기 는 클릭하지 않았다', (await pay.c.evaluate('window.__PAY_COUNT || 0')) === 0);

  // 연락처가 3조각으로 나뉜 사이트(다른 아임웹 설정)에서도 동작해야 한다 — 실측 사이트는 한 줄이라 여기서 함께 검증
  await pay.c.evaluate(`(() => {
    document.querySelectorAll('[name=orderer_call]').forEach((e) => e.remove());
    const td = document.querySelector('[name=deliv_memo]').closest('td');
    td.insertAdjacentHTML('beforeend', '<input type=text name=hp1 maxlength=3><input type=text name=hp2 maxlength=4><input type=text name=hp3 maxlength=4>');
    window.__DPS_FILL = null; window.__FILL_ERR = null;
  })()`);
  const frag = await pay.c.evaluate(`(async () => {
    (${dpsFiller.toString()})(${JSON.stringify(WANT)});
    for (let i = 0; i < 120; i++) { if (window.__DPS_FILL && (window.__DPS_FILL.at || window.__DPS_FILL.err)) break; await new Promise((r) => setTimeout(r, 25)); }
    return { f: window.__DPS_FILL, hp: ['hp1', 'hp2', 'hp3'].map((n) => document.querySelector('[name=' + n + ']').value) };
  })()`);
  await t('연락처 3조각 사이트에서는 010/1234/5678 로 나눈다', JSON.stringify(frag.hp) === JSON.stringify(['010', '1234', '5678']), JSON.stringify(frag.hp));

  // 회귀: 배경 탭(포커스가 다른 창)에서는 requestAnimationFrame 이 멈춰 채움이 1차에서 죽는다(실측 for 발견).
  // document.hidden + rAF 정지를 재현해도 setTimeout 으로 끝까지 채워야 한다.
  await pay.c.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    window.__RAF = 0; window.requestAnimationFrame = () => { window.__RAF++; return 0; };   // rAF 이 아무것도 예약하지 않는다
    ['hp1', 'hp2', 'hp3'].forEach((n) => { document.querySelector('[name=' + n + ']').value = ''; });   // 재시도가 필요하게 만든다
    window.__DPS_FILL = null; window.__FILL_ERR = null;
  })()`);
  const bg = await pay.c.evaluate(`(async () => {
    (${dpsFiller.toString()})(${JSON.stringify(WANT)});
    for (let i = 0; i < 120; i++) { if (window.__DPS_FILL && (window.__DPS_FILL.at || window.__DPS_FILL.err)) break; await new Promise((r) => setTimeout(r, 40)); }
    return { s: window.__DPS_FILL, raf: window.__RAF, hp: ['hp1', 'hp2', 'hp3'].map((n) => document.querySelector('[name=' + n + ']').value) };
  })()`);
  await t('배경 탭(rAF 정지)에서도 setTimeout 으로 끝까지 채운다', !!bg.s.at && !bg.s.err && bg.hp.join('') === '01012345678', JSON.stringify({ at: !!bg.s.at, hp: bg.hp.join('/'), err: bg.s.err, raf: bg.raf }));
  await close(pay.tab);

  /* ---------- ④ '예약하기' 게이트 ---------- */
  const sl = await open(SLOT.href);
  const want = { idx: '36', day: '2026-09-15' };
  const book = (o) => sl.c.evaluate(`(${dpsBook.toString()})(${JSON.stringify(o)})`);
  const count = () => sl.c.evaluate('window.__BOOK_COUNT || 0');

  const guestPrev = await book({ want, preview: true });
  await t('로그아웃이면 프리뷰에서 막는다', guestPrev.problems.some((p) => /로그아웃/.test(p)), guestPrev.problems.join(','));
  await sl.c.evaluate('window.setGuest(false)');
  const okPrev = await book({ want, preview: true });
  await t('로그인 + 좌표 일치면 검증 통과 (금액 56,000원)', okPrev.problems.length === 0 && /56,000/.test(okPrev.price), okPrev.problems.join(',') + ' / ' + okPrev.price);
  await t('보이는 예약하기 는 정확히 1개 (모바일 복제본 제외)', (await sl.c.evaluate(`(${dpsSlotRead.toString()})()`)).buttons === 1);
  await t('프리뷰는 클릭하지 않는다', (await count()) === 0);
  await t('좌표(prod_idx)가 다르면 거부', (await book({ want: { idx: '99', day: '2026-09-15' }, preview: false })).problems.some((p) => /prod_idx/.test(p)));
  await t('날짜(start_day)가 다르면 거부', (await book({ want: { idx: '36', day: '2026-09-16' }, preview: false })).problems.some((p) => /start_day/.test(p)));
  await t('검증 통과 시 클릭하고 ok=true', (await book({ want, preview: false })).ok === true && (await count()) === 1);
  await t('재호출해도 중복 클릭하지 않는다', (await book({ want, preview: false })).problems.some((p) => /이미 클릭/.test(p)) && (await count()) === 1);
  await t('로그인 스냅샷이 회원 블록을 읽는다', (await sl.c.evaluate(`(${dpsLoginRead.toString()})()`)).memberBlock === true);
  await close(sl.tab);
} catch (e) {
  await t('브라우저(CDP) 테스트', false, String(e && e.message).slice(0, 90) + ' — Chrome --remote-debugging-port 필요');
}

console.log(`\n${total - fail}/${total} PASS`);
process.exit(fail ? 1 : 0);
