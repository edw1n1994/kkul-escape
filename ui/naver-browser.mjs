export function naverLoginRead() {
  const buttons = [...document.querySelectorAll('a,button')].filter(e => e.getClientRects().length);
  const loggedIn = buttons.some(e => e.textContent.trim() === '로그아웃') ? true
    : buttons.some(e => e.textContent.trim() === '로그인') ? false : null;
  return { ok: true, loggedIn, msg: loggedIn === true ? '네이버 로그인 확인됨' : loggedIn === false ? '네이버에서 로그인해 주세요' : '로그인 상태 확인 중' };
}
/** Only the normal visible Naver calendar/time/next controls are used. No booking API replay. */
export function naverPage({ product, date, time, action = 'read' }) {
  const fail = msg => ({ ok: false, msg });
  const url = new URL(location.href);
  const itemPath = new URL(product.url).pathname;
  if (url.hostname !== 'booking.naver.com' || ![itemPath, itemPath + '/request'].includes(url.pathname.replace(/\/$/, ''))) return { ...fail('목표 네이버 상품 페이지가 아닙니다'), blocked: url.hostname !== 'booking.naver.com' };
  if (url.pathname === itemPath + '/request') {
    const selected = url.searchParams.get('startDateTime');
    if (date && time && selected && (selected.slice(0, 10) !== date || selected.slice(11, 16) !== time)) return { ...fail('신청서 날짜/시간 불일치'), blocked: true };
    return { ok: true, request: true, msg: '신청서 도착 — 최종 확인·결제는 직접 진행하세요' };
  }
  const visible = e => !!e?.getClientRects().length;
  const text = document.body?.innerText || '';
  if (/접속이 지연|요청이 너무 많|비정상적인 접근|잠시 후 다시/.test(text)) return { ...fail('네이버 요청 제한/오류 화면 — 자동 재시도 중단'), blocked: true };
  const login = [...document.querySelectorAll('a,button')].some(e => visible(e) && e.textContent.trim() === '로그아웃');
  if (/자동입력방지|로봇이 아닙니다|본인인증을 진행|보안 확인을 완료/.test(text)) return { ...fail('추가 인증을 직접 완료하세요'), blocked: true };
  const title = document.title;
  const normalize = s => String(s).replace(/[\s,.]/g, '');
  if (!normalize(title).includes(normalize(product.name))) return fail('상품명 확인 중');
  const calendar = [...document.querySelectorAll('.calendar_month')].find(visible);
  const month = calendar?.querySelector('.calendar_title')?.textContent.match(/(\d{4})\.(\d{1,2})/);
  if (!month) return fail('네이버 달력을 찾지 못했습니다');
  const monthKey = month[1] + '-' + month[2].padStart(2, '0');
  const first = Date.UTC(Number(month[1]), Number(month[2]) - 1, 1);
  const start = first - new Date(first).getUTCDay() * 86400000;
  const days = [...calendar.querySelectorAll('.calendar_date')].map((button, i) => ({
    button, date: new Date(start + i * 86400000).toISOString().slice(0, 10),
    enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !/unselectable|disabled/.test(button.className),
    selected: button.getAttribute('aria-selected') === 'true',
  }));
  const selectedDate = days.find(d => d.selected)?.date || '';
  const target = days.find(d => d.date === date);
  const timeOf = label => {
    const m = label.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hour = m[1] ? Number(m[2]) % 12 + (m[1] === '오후' ? 12 : 0) : Number(m[2]);
    return String(hour).padStart(2, '0') + ':' + m[3];
  };
  const controls = [...document.querySelectorAll('.time_list .btn_time')].filter(visible).map(button => ({
    button, time: timeOf(button.textContent),
    open: !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.classList.contains('unselectable') && !/매진|마감/.test(button.textContent),
    selected: button.getAttribute('aria-selected') === 'true',
  })).filter(row => row.time);
  // Read only already-loaded public schedule data to distinguish a stale previous-date list.
  const cache = window.__APOLLO_CLIENT__?.cache.extract() || window.__APOLLO_STATE__ || {};
  const scheduleEntry = Object.entries(cache.ROOT_QUERY || {}).find(([key, value]) => {
    if (!key.startsWith('schedule(') || !value?.bizItemSchedule?.hourly) return false;
    try { const q = JSON.parse(key.slice(9, -1)).input; return String(q.bizItemId) === String(product.theme) && String(q.businessId) === String(product.business) && q.startDateTime.startsWith(date + 'T') && q.endDateTime.startsWith(date + 'T'); } catch { return false; }
  });
  const header = date ? `${Number(date.slice(5, 7))}. ${Number(date.slice(8, 10))}(` : '';
  // Both locked+selected can coexist before opening. Never use selected alone.
  const loaded = !!target?.enabled && selectedDate === date && !!scheduleEntry && text.includes(header);
  const result = { ok: true, nextRequested: !!window.__NAVER_NEXT_CLICKED, wantTime: time, title, loggedIn: login, date: selectedDate, month: monthKey,
    dateEnabled: !!target?.enabled, loaded, slots: loaded ? controls.map(({ time, open, selected }) => ({ num: time, time, open, selected })) : [],
    msg: !target?.enabled ? '선택한 날짜가 아직 열리지 않았습니다' : !loaded ? '회차 로딩 대기' : '' };
  if (action === 'date') {
    if (monthKey !== date.slice(0, 7)) {
      const button = calendar.querySelector(monthKey < date.slice(0, 7) ? '.btn_next' : '.btn_prev');
      if (button && !button.disabled && !button.classList.contains('disabled')) { button.click(); return { ...result, changed: true }; }
      return { ...result, changed: false };
    }
    if (target?.enabled && !loaded) { target.button.click(); return { ...result, changed: true }; }
    return { ...result, changed: false };
  }
  if (action === 'time' || action === 'next') {
    if (!loaded) return fail('목표 날짜/회차 로딩 미완료');
    const matches = controls.filter(row => row.time === time && row.open);
    if (matches.length !== 1) return fail('목표 회차가 매진되었거나 버튼이 모호합니다');
    if (action === 'time') { matches[0].button.click(); return { ...result, clicked: true }; }
    if (!matches[0].selected) return fail('선택한 회차 불일치');
    if (!login) return fail('네이버 로그인 확인 필요');
    if (window.__NAVER_NEXT_CLICKED) return fail('이미 다음 단계로 이동 요청함');
    const buttons = [...document.querySelectorAll('[data-click-code="nextbuttonview.request"]')].filter(visible);
    if (buttons.length !== 1 || buttons[0].disabled || /disabled/i.test(buttons[0].className) || buttons[0].getAttribute('aria-disabled') === 'true' || buttons[0].textContent.trim() !== '다음') return fail('다음 버튼 확인 필요');
    window.__NAVER_NEXT_CLICKED = true;
    buttons[0].click();
    return { ...result, clicked: true, msg: '다음 1회 클릭 — 최종 예약 확인·결제는 브라우저에서 진행하세요' };
  }
  return result;
}

/** Final booking confirmation is opt-in and restricted to a selected bank deposit method. */
export function naverBankPage({ product, date, time, maxAmount, action = 'read' }) {
  const fail = (msg, blocked = false) => ({ ok: false, msg, blocked });
  const visible = e => !!e?.getClientRects().length;
  const normalize = s => String(s || '').replace(/[\s,.]/g, '');
  const url = new URL(location.href), item = new URL(product.url);
  if (url.origin !== item.origin || url.pathname.replace(/\/$/, '') !== item.pathname + '/request') return fail('목표 신청서가 아닙니다. 브라우저에서 예약 결과를 확인하세요.', true);
  const stamp = url.searchParams.get('startDateTime');
  if (!stamp) return fail('신청서의 예약 일시를 확인할 수 없습니다.', true);
  const wallTime = /(?:Z|[+-]\d\d:\d\d)$/.test(stamp)
    ? new Date(Date.parse(stamp) + 9 * 3600000).toISOString().slice(0, 16) : stamp.slice(0, 16);
  if (wallTime !== date + 'T' + time) return fail('신청서 날짜·시간이 목표와 다릅니다.', true);
  const body = document.body?.innerText || '';
  if (/자동입력방지|로봇이 아닙니다|본인인증을 진행|보안 확인을 완료|접속이 지연|요청이 너무 많|비정상적인 접근/.test(body)) return fail('인증 또는 접근 제한 화면입니다. 직접 확인해 주세요.', true);
  const challenges = [...document.querySelectorAll('iframe,[id*="captcha"],[class*="captcha"]')].filter(visible);
  if (challenges.some(e => /captcha|sec\.naver/i.test([e.src, e.id, e.className].join(' ')))) return fail('추가 인증을 직접 완료해 주세요.', true);
  const info = [...document.querySelectorAll('.section_booking_info')].filter(visible);
  if (info.length !== 1) return fail('예약 내용이 표시되기를 기다립니다.');
  const infoText = info[0].innerText || '';
  if (!normalize(infoText + document.title).includes(normalize(product.name))) return fail('신청서 상품명이 목표와 다릅니다.', true);
  const month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  const datePattern = new RegExp('(?:^|[^0-9])' + month + '\\s*(?:\\.|월)\\s*' + day + '(?:\\s*(?:\\.|일|\\()|[^0-9]|$)');
  const hour = Number(time.slice(0, 2)), minute = time.slice(3);
  const timePattern = new RegExp('(?:^|[^0-9])(?:' + time + '|' + (hour < 12 ? '오전' : '오후') + '\\s*' + (hour % 12 || 12) + ':' + minute + ')(?:[^0-9]|$)');
  if (!datePattern.test(infoText) || !timePattern.test(infoText)) return fail('화면에 표시된 방문 날짜·시간을 확인할 수 없습니다.');
  const buttons = [...document.querySelectorAll('a,button')].filter(visible);
  if (!buttons.some(e => e.textContent.trim() === '로그아웃')) return fail('네이버 로그인 확인이 필요합니다.');
  const inputs = [...document.querySelectorAll('.booking_form_wrap input:not([type="hidden"]),.booking_form_wrap textarea,.booking_form_wrap select')].filter(visible);
  if (inputs.some(e => e.required && !e.disabled && !['radio', 'checkbox'].includes(e.type) && (!String(e.value || '').trim() || e.validity?.valid === false))) return fail('필수 예약자 정보를 입력해 주세요.');
  const unchecked = inputs.filter(e => e.type === 'checkbox' && e.required && !e.checked);
  if (unchecked.length) return fail('필수 약관 동의를 확인해 주세요.');
  const radios = [...document.querySelectorAll('input[type="radio"]')].filter(e => visible(e) || [...(e.labels || [])].some(visible));
  const label = e => [...(e.labels || [])].map(l => l.innerText || l.textContent || '').join(' ').replace(/\s/g, '');
  const banks = radios.filter(e => /^(?:무통장입금|가상계좌(?:무통장입금)?)$/.test(label(e)) && ['BANK_DEPOSIT', 'VIRTUAL_ACCOUNT'].includes(e.value));
  if (banks.length !== 1 || !banks[0].name) return fail('무통장입금 결제수단을 확인할 수 없습니다. 다른 결제수단으로 진행하지 않습니다.', true);
  const bank = banks[0];
  if (bank.disabled) return fail('무통장입금이 비활성화되어 있습니다.', true);
  if (!bank.checked) {
    if (action === 'select-bank') { bank.click(); return { ok: true, selected: true, msg: '무통장입금 선택 반영 대기' }; }
    return fail('무통장입금 선택을 확인하고 있습니다.');
  }
  if (radios.some(e => e !== bank && e.name === bank.name && e.checked)) return fail('결제수단 선택이 모호합니다.', true);
  const totals = [...document.querySelectorAll('.booking_price_total')].filter(visible);
  if (totals.length !== 1) return fail('예약금 합계를 확인할 수 없습니다.');
  const prices = [...(totals[0].innerText || '').matchAll(/([0-9][0-9,]*)\s*원/g)].map(m => Number(m[1].replace(/,/g, '')));
  if (prices.length !== 1 || !Number.isSafeInteger(prices[0]) || prices[0] <= 0) return fail('예약금이 여러 개이거나 불명확합니다. 직접 확인해 주세요.', true);
  const amount = prices[0];
  if (!Number.isSafeInteger(maxAmount) || maxAmount <= 0 || amount > maxAmount) return fail('예약금이 설정한 상한을 초과하거나 상한이 없습니다.', true);
  const finalButtons = [...document.querySelectorAll('button.btn_request')].filter(visible);
  if (finalButtons.length !== 1) return fail('최종 확정 버튼을 하나로 확인할 수 없습니다.');
  const button = finalButtons[0], caption = button.textContent.trim();
  if (!['동의하고 결제하기', '동의하고 예약하기', '동의하고 예약 신청하기', '동의하고 예약금 결제하기'].includes(caption)) return fail('지원하는 최종 예약 버튼이 아닙니다.', true);
  if (button.disabled || /disabled/.test(button.className) || button.getAttribute('aria-disabled') === 'true') return fail('최종 확정 버튼이 아직 비활성화되어 있습니다.');
  const key = 'kkul.naver.bank-confirm:' + product.business + ':' + product.theme + ':' + date + ':' + time;
  try { if (sessionStorage.getItem(key)) return fail('이미 확정을 요청했습니다. 중복 클릭하지 않습니다.', true); }
  catch { return fail('중복 방지 기록을 사용할 수 없습니다.', true); }
  if (action !== 'confirm') return { ok: true, ready: true, amount, msg: '무통장입금 예약 정보 확인됨' };
  // Record BEFORE the click. A navigation/timeout must never cause resubmission.
  sessionStorage.setItem(key, 'requested');
  button.click();
  return { ok: true, clicked: true, amount, msg: '무통장입금 예약 확정 1회 요청' };
}
