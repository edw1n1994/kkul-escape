/**
 * reservation1.php 콘솔에 붙여넣는 Step1 자동 입력.
 *   1) 전체를 복사해 콘솔 실행 -> window.KEY 정의
 *   2) KEY({zizum:25, theme:72, date:'2026-09-08', time:2604, submit:true})
 * submit:false 면 입력까지만. date/time 을 생략하면 최초 선택가능 항목을 고른다.
 *
 * ※ 필드명 주의: reservation1.php 의 폼은 zizumNum / themeNum / themeInfoNum /
 *    revDays / themeTimeNum (camelCase) 이고, zizum_num · theme_num · rev_days ·
 *    theme_time_num (snake_case) 은 reservation2.php 쪽 이름이다. fun_submit() 은 존재하지 않는다.
 */
window.KEY = async function (opts = {}) {
  const O = { zizum: '18', theme: '58', date: '', time: '', submit: false, ...opts };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (fn, ms, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(150); }
    throw new Error('타임아웃: ' + label);
  };
  const zSel = document.querySelector('#zizum'), tSel = document.querySelector('#theme');
  if (!zSel || !tSel) throw new Error('reservation1 페이지가 아닙니다');

  zSel.value = String(O.zizum);
  zSel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => tSel.querySelector('option[data-themenum]'), 15000, '테마 목록');

  const opt = [...tSel.options].find((o) => String(o.dataset.themenum) === String(O.theme));
  if (!opt) {
    throw new Error('테마 ' + O.theme + ' 이 지점 ' + O.zizum + ' 에 없음. 선택지: '
      + [...tSel.options].filter((o) => o.value).map((o) => o.dataset.themenum + '=' + o.textContent.trim()).join(' / '));
  }
  tSel.value = opt.value;
  tSel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.querySelector('#datepicker .selDate'), 15000, '달력');

  let cell = O.date
    ? [...document.querySelectorAll('.selDate')].find((c) => c.dataset.date === String(O.date))
    : [...document.querySelectorAll('.selDate')].find((c) => !c.classList.contains('disabled'));
  if (!cell) throw new Error('날짜 ' + O.date + ' 을 달력에서 찾을 수 없음 (미오픈/다른 달)');
  if (cell.classList.contains('disabled')) throw new Error(O.date + ' 은 disabled (doing=' + opt.dataset.doing + '일 오픈 창 밖)');
  cell.click();
  await wait(() => document.querySelector('.selThemeTimeNum'), 15000, '시간 목록');

  const radios = [...document.querySelectorAll('.selThemeTimeNum')];
  const radio = O.time ? radios.find((r) => String(r.value) === String(O.time)) : radios.find((r) => !r.disabled);
  if (!radio) throw new Error('슬롯 ' + O.time + ' 없음. 선택지: ' + radios.map((r) => r.value + '=' + r.nextElementSibling.textContent.trim() + (r.disabled ? '(마감)' : '')).join(' / '));
  if (radio.disabled) throw new Error('슬롯 ' + radio.value + ' 은 마감됨');
  radio.click();

  const payload = {};
  document.querySelectorAll('#form input').forEach((i) => (payload[i.name] = i.value));
  const summary = document.querySelector('#reservInfo').value;

  if (O.submit) {
    setTimeout(() => document.querySelector('.btn_next_step').click(), 200);
  }
  console.log('요약:', summary, '\nSTEP2 로 넘길 POST body:', {
    zizumNum: String(O.zizum), themeNum: String(O.theme), themeInfoNum: opt.value,
    revDays: cell.dataset.date, themeTimeNum: radio.value,
    revTimes: radio.nextElementSibling.textContent.trim(), themeName: opt.textContent.trim(),
  });
  return { summary, date: cell.dataset.date, themeInfoNum: opt.value, themeTimeNum: radio.value, submitted: !!O.submit };
};
console.log('KEY() 준비됨. 예: KEY({zizum:25, theme:72, date:"2026-09-08", time:2604, submit:true})');
