/**
 * step1.mjs 이 브라우저 페이지 컨텍스트에서 실행하는 본문.
 * 전역 OPTS = { zizum, theme, date, time, submit } 를 읽고 리포트 객체를 반환한다.
 *
 * 정석 경로: #zizum change -> #theme change -> .selDate 클릭 -> .selThemeTimeNum 클릭 -> NEXT
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(150); }
  throw new Error('타임아웃: ' + label);
};
const log = [];
const zSel = document.querySelector('#zizum'), tSel = document.querySelector('#theme');
if (!zSel || !tSel) throw new Error('select 를 찾지 못함 (reservation1 페이지인가?)');

// 1) 지점 선택
zSel.value = String(OPTS.zizum);
zSel.dispatchEvent(new Event('change', { bubbles: true }));
await wait(() => tSel.querySelector('option[data-themenum]'), 15000, '테마 목록');
log.push('지점 ' + OPTS.zizum + ' -> 테마 ' + tSel.options.length + '개 로드');

// 2) 테마 선택
const opt = [...tSel.options].find((o) => String(o.dataset.themenum) === String(OPTS.theme));
if (!opt) {
  throw new Error('테마 ' + OPTS.theme + ' 없음. 이 지점의 선택지: '
    + [...tSel.options].filter((o) => o.value).map((o) => o.dataset.themenum + '=' + o.textContent.trim()).join(', '));
}
tSel.value = opt.value;
tSel.dispatchEvent(new Event('change', { bubbles: true }));
await wait(() => document.querySelector('#datepicker .selDate'), 15000, '달력');
log.push('테마 ' + OPTS.theme + ' (themeInfoNum=' + opt.value + ', ' + opt.textContent.trim() + ') 달력 렌더');

// 3) 날짜 선택
let cell = null;
if (OPTS.date) {
  cell = [...document.querySelectorAll('.selDate')].find((c) => c.dataset.date === OPTS.date);
  if (!cell) throw new Error('달력에 ' + OPTS.date + ' 없음 (다른 달이거나 미오픈)');
  if (cell.classList.contains('disabled')) {
    throw new Error(OPTS.date + ' 은 disabled (doing=' + (opt.dataset.doing) + ' 일 오픈 창 밖). 달력에서 available 날짜 확인 필요');
  }
} else {
  cell = [...document.querySelectorAll('.selDate')].find((c) => !c.classList.contains('disabled'));
  if (!cell) throw new Error('선택 가능한 날짜가 없음');
}
const chosenDate = cell.dataset.date;
cell.click();
await wait(() => document.querySelector('.selThemeTimeNum'), 15000, '시간 목록');
log.push('날짜 ' + chosenDate + ' -> 시간 슬롯 ' + document.querySelectorAll('.selThemeTimeNum').length + '개 로드');

// 4) 시간 선택
const radios = [...document.querySelectorAll('.selThemeTimeNum')];
let radio = null;
if (OPTS.time) {
  radio = radios.find((r) => String(r.value) === String(OPTS.time));
  if (!radio) {
    throw new Error('슬롯 ' + OPTS.time + ' 없음. 이 날짜의 선택지: '
      + radios.map((r) => r.value + '=' + r.nextElementSibling.textContent.trim() + (r.disabled ? '(마감)' : '')).join(', '));
  }
} else {
  radio = radios.find((r) => !r.disabled);
}
if (!radio) throw new Error('선택 가능한 시간이 없음');
if (radio.disabled) throw new Error('슬롯 ' + radio.value + ' 은 마감됨');
radio.click();
log.push('시간 value=' + radio.value + ' (' + radio.nextElementSibling.textContent.trim() + ')');

const filled = {};
document.querySelectorAll('#form input').forEach((i) => (filled[i.name] = i.value));
const reservInfo = document.querySelector('#reservInfo').value;

// 5) NEXT 는 리포트를 먼저 돌려보낸 뒤 비동기로 클릭한다 (네비게이션으로 eval 이 죽는 것 방지)
if (OPTS.submit) {
  setTimeout(() => document.querySelector('.btn_next_step').click(), 300);
  log.push('NEXT 클릭 예약 -> reservation2.php 로 이동');
} else {
  log.push('--no-submit : 입력까지만 하고 제출 생략');
}

return { log, chosenDate, chosenTime: radio.value, reservInfo, filledForm: filled };
