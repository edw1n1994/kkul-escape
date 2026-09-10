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
