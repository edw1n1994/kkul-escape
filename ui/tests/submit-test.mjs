#!/usr/bin/env node
/**
 * step2Submit ('예약하기' 자동 클릭) 검증 — 실제 사이트가 아니라 목업 폼에서 돌린다.
 *
 *   node ui/tests/submit-test.mjs [--port 9222]
 *
 * 목업은 reservation2 의 구조(#form / g-recaptcha-response / 약관 / good_mny / button.submit.pc) 를 복제하고,
 * submit 리스너가 preventDefault 하므로 결제 이동은 일어나지 않는다.
 * reCAPTCHA 토큰은 '사람이 통과한 상태' 를 재현한 값이며, 코드 자체가 토큰을 만들지는 않는다.
 */
import { cdp, sleep, step2Submit, STEP2_READ } from '../lib.mjs';
import { readFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1] || 9222);
const FIX = new URL('./fixture-step2.html', import.meta.url);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(FIX.href)}`, { method: 'PUT' }).then((r) => r.json());
const c = cdp(tab.webSocketDebuggerUrl);
await c.ready;
await c.send('Runtime.enable');
await sleep(1200);

const WANT = { zizum_num: '22', theme_num: '65', theme_info_num: '43', rev_days: '2026-09-10', theme_time_num: '2176' };
const AGREES = ['agree_1', 'agree_2'];
const call = (o) => c.evaluate(`(${step2Submit.toString()})(${JSON.stringify(o)})`);
const count = () => c.evaluate('window.__SUBMIT_COUNT');
let fail = 0, total = 0;
const t = async (name, cond, extra) => { total++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`); if (!cond) fail++; };

const p = await call({ want: WANT, agrees: AGREES, preview: true });
await t('프리뷰: 제출 버튼을 정확히 1개 찾는다', /예약하기/.test(p.btn) && p.ok === true, p.btn);
await t('프리뷰: 상품명/금액을 함께 보고', p.good === '머니머니부동산(09:50)' && p.mny === '68000', `${p.good} / ${p.mny}원`);
await t('프리뷰: 클릭하지 않는다', await count() === 0);

// 상품명/금액이 결제 폼(order_info) 밖에 있는 실제 페이지 구조에서도 찾아야 한다 (실측에서 실패했던 회귀)
await c.evaluate(`(() => { const o = document.forms.order_info; o.good_name.value = ''; o.good_mny.value = ''; })()`);
const p2 = await call({ want: WANT, agrees: AGREES, preview: true });
await t('order_info 가 비어도 화면 문구에서 상품명·금액을 찾는다', p2.good === '머니머니부동산' && p2.mny === '68000', `${p2.good} / ${p2.mny}원`);
await c.evaluate(`(() => { document.querySelector('.goods_info').textContent = ''; })()`);
const p3 = await call({ want: WANT, agrees: AGREES, preview: true });
await t('상품명도 문구도 없으면 여전히 클릭 거부 (검증 유지)', p3.ok === false && /상품명\/금액 없음/.test((p3.problems || []).join(',')), (p3.problems || []).join(','));
await c.evaluate(`(() => {
  const o = document.forms.order_info; o.good_name.value = '머니머니부동산(09:50)'; o.good_mny.value = '68000';
  document.querySelector('.goods_info').textContent = '예약 상품 정보 머니머니부동산 2026.09.10 09:50 [ 안내 사항 ] -이용금액 머니머니부동산 : 68,000원';
})()`);

const a = await call({ want: WANT, agrees: AGREES, preview: false });
await t('캡차 토큰 없으면 클릭 거부', a.ok === false && /reCAPTCHA/.test(a.why), a.why);
await t('거부 시 제출 0회', await count() === 0);

const b = await call({ want: { ...WANT, theme_time_num: '9999' }, agrees: AGREES, preview: false });
await t('예약좌표가 다르면 클릭 거부', b.ok === false && /예약좌표 불일치/.test((b.problems || []).join(',')), (b.problems || []).join(','));

await c.evaluate(`(() => { document.forms[0].agree_1.checked = false; })()`);
const cc = await call({ want: WANT, agrees: AGREES, preview: false });
await t('약관 미체크면 클릭 거부', cc.ok === false && /약관 미체크/.test((cc.problems || []).join(',')), (cc.problems || []).join(','));
await c.evaluate(`(() => { document.forms[0].agree_1.checked = true; })()`);

await c.evaluate(`(() => { document.forms[0].name.value = ''; })()`);
const d = await call({ want: WANT, agrees: AGREES, preview: false });
await t('이름이 비어 있으면 클릭 거부', d.ok === false && /이름 미입력/.test((d.problems || []).join(',')), (d.problems || []).join(','));
await c.evaluate(`(() => { document.forms[0].name.value = '테스트유저'; })()`);

// 사람이 캡차를 통과한 상태를 재현한 뒤에만 실제 클릭이 일어나는지
await c.evaluate(`(() => { document.forms[0]['g-recaptcha-response'].value = 'X'.repeat(400); })()`);
const e = await call({ want: WANT, agrees: AGREES, preview: false });
await t('토큰 존재 + 검증 통과 시 클릭', e.ok === true && /클릭 완료/.test(e.why), e.why);
await t('제출은 정확히 1회', await count() === 1);

const f2 = await call({ want: WANT, agrees: AGREES, preview: false });
await t('재호출해도 중복 클릭하지 않는다', f2.ok === false && /이미 제출됨/.test(f2.why), f2.why);
await t('제출 여전히 1회', await count() === 1);

/* 사이트의 자동화 차단 화면(devtools-detector 가 body 를 교체한 상태) 을 감지하는지 */
const bfix = new URL('./fixture-blocked.html', import.meta.url);
const btab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(bfix.href)}`, { method: 'PUT' }).then((r) => r.json());
const bc = cdp(btab.webSocketDebuggerUrl);
await bc.ready;
await bc.send('Runtime.enable');
await sleep(800);
const bs = await bc.evaluate(STEP2_READ).catch((e) => ({ err: e.message }));
await t('차단 화면을 STEP2_READ 가 감지한다', bs.blocked === true, JSON.stringify({ blocked: bs.blocked, forms: bs.hidden }));
const bcall = await bc.evaluate(`(${step2Submit.toString()})(${JSON.stringify({ want: WANT, agrees: AGREES, preview: false })})`)
  .catch((e) => ({ ok: false, why: e.message }));
await t('차단 화면에서는 제출을 시도하지 않는다', bcall.ok === false && bcall.blocked === true, bcall.why);
await fetch(`http://127.0.0.1:${PORT}/json/close/${btab.id}`).catch(() => {});

// 회귀: 포커스가 다른 창에 가면(배경 탭) requestAnimationFrame 이 멈춰 재시도가 죽는다 — 실측에서
// 단편선 결제화면 채움이 1차 시도시도 끝나지 않았다. 세 주입 입력기(lib.filler · sites.zwFiller · dps.dpsFiller)
// 모두 document.hidden 일 때 setTimeout 으로 우회해야 한다. (동작 자체는 dps-test.mjs 의 '배경 탭(rAF 정지)' 항목이 실제로 검증한다.)
const src = await Promise.all(['../lib.mjs', '../sites.mjs', '../dps.mjs'].map((f) => readFile(new URL(f, import.meta.url), 'utf8')));
await t('세 입력기 모두 배경 탭(rAF 정지) 대비 setTimeout 분기가 있다', src.every((s) => /document\.hidden[\s\S]{0,90}setTimeout/.test(s)), src.map((s) => (/document\.hidden/.test(s) ? 'O' : 'X')).join(' '));

await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).catch(() => {});
console.log(fail ? `\n실패 ${fail} 건 (전체 ${total})` : `\n${total}/${total} 통과 — 클릭은 [토큰 존재 + 좌표/약관/예약자/상품명·금액 검증] 후에만 1회, 차단 화면에서는 시도조차 하지 않습니다`);
process.exit(fail ? 1 : 0);