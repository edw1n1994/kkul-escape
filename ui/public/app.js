const $ = (id) => document.getElementById(id);
const refreshUI = () => window.bookingUI?.sync();
const S = { time: '', date: '', themes: [], sse: null, today: '', matrix: [], site: localStorage.getItem('ke.site') || 'keyescape', sites: [], branchSite: '' };
const TABS = [{ key: 'keyescape', label: '키이스케이프' }, { key: 'zeroworld', label: '제로월드' }];
const isZw = () => S.site === 'zeroworld';
const isDps = () => S.site === 'dps';
const isNaver = () => S.site === 'naver';
const isRhe = () => S.site === 'rhe';
/** 신청서형 사이트 — 앱이 시간 선택과 신청서 입력까지 하고, 마지막 버튼(서버가 알려 주는 finalButton) 은 사람이 누른다 */
const FORM_SITES = new Set(['rhe', 'jgb', 'ptd', 'oas']);
const isForm = (k = S.site) => FORM_SITES.has(k);
const finalBtn = () => S.finalButton || '예약하기';
/** 받침에 따라 조사를 고른다 ('예약하기'는 / '예약 확정'은) */
const josa = (w, withJong, without) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return c >= 0 && c <= 11171 && c % 28 ? withJong : without; };
const FORM_HINT = {
  rhe: '토끼굴은 <b>오늘부터 +6일까지만 조회되는 롤링 창</b>입니다.',
  jgb: '지구별은 <b>지점마다 예약 창이 다릅니다</b> (대구점 오늘+14일, 홍대 두 지점 오늘+6일 — 날짜표로 실제 창 끝을 읽습니다).',
  ptd: '오늘의 한 페이지는 <b>예약 서버에 시간표가 있는 마지막 날짜</b>까지 예약됩니다 (지금은 오늘+6일).',
  oas: '오아시스 뮤지엄은 <b>매일 자정에 6일 뒤 날짜가 열립니다</b> (사이트 안내문).',
};
/** 네이버 무통장입금 예약 확정 — 서버가 켜 둔 경우(KKUL_NAVER_BANK=1)에만 화면에 보이고 실행에 실린다 */
const bankOn = () => isNaver() && !!S.naverBank && !!$('naverConfirm')?.checked;
/** 사이트별 '예약하기' 자동 클릭 기본값 — 단편선은 캡차가 없고 예약좌표 검증이 가능해 on, 키이스케이프는 off (토끼굴은 자동 클릭 자체가 없다) */
const autoKey = () => 'ke.autosub' + (isNaver() ? '.naver' : isDps() ? '.dps' : isZw() ? '.zeroworld' : isForm() ? '.' + S.site : '');
const autoDefault = () => (isDps() || isNaver() ? '1' : '0');
const subWanted = () => (localStorage.getItem(autoKey()) !== null ? localStorage.getItem(autoKey()) : autoDefault()) === '1';
function renderTabs() {
  const list = (S.sites && S.sites.length) ? S.sites : TABS;
  $('siteTabs').innerHTML = list.map((s) => `<button class="tab ${s.key === S.site ? 'on' : ''}" onclick="setSite('${s.key}')">${s.label}</button>`).join('');
}
/** 안내 문구를 사이트에 맞게 (화면 구조는 동일, 흐름만 다르다) */
function copySite() {
  const zw = isZw();
  $('naverOpen').style.display = isNaver() ? '' : 'none';
  $('nameWrap').style.display = $('hpWrap').style.display = isNaver() ? 'none' : '';
  $('bLock').style.display = isNaver() ? 'none' : '';
  $('openHint').innerHTML = isNaver() ? '요일별 참고 시간표입니다. 실제 회차·예약 가능 여부는 네이버 화면에서 확인합니다. 예약자 정보는 네이버 계정 정보를 사용합니다.' : isForm()
    ? (FORM_HINT[S.site] || '') + ' 창 안 날짜(이미 예약되는 날)는 대상에서 빼고, <b>아직 창 밖인 날짜</b>를 고르면 그 날짜가 열리는 시각에 맞춰 시간 버튼이 자동 클릭됩니다.' + (S.site === 'oas' ? '' : ' 이 사이트는 오픈 시각 공지가 없어 창이 밀리는 시각을 자정으로 봅니다.')
    : zw
      ? '이미 예약이 열린 날짜 / 지난 날짜는 대상에서 뺍니다(<b>이미 오픈</b>으로 표시, 클릭 불가). <b>아직 오픈 전인 날짜(보통 15일 이후)</b>의 시간대만 고를 수 있고, 지점 오픈 시각(홍대 12:00 / 강남 11:30 — 서버 문구에서 읽음)에 시간 목록이 뜨는 그 순간 자동 선택됩니다.'
      : '이미 예약이 열린 날짜 / 지난 날짜는 대상에서 뺍니다(<b>이미 오픈</b>으로 표시, 클릭 불가). <b>아직 오픈 전인 날짜(보통 7일 이후)</b>의 시간대만 고를 수 있고, 오픈 시각에 <code>enable=Y</code> 로 바뀌는 그 순간 자동 제출됩니다.';
  $('step2Title').firstChild.textContent = isNaver() ? '네이버 예약 상태 ' : isForm() ? '신청서 상태 ' : zw ? '예약 폼 상태 ' : 'Step2 도착 상태 ';
  if ($('rhePersonWrap')) $('rhePersonWrap').style.display = isForm() ? '' : 'none';   // '예약 인원' 은 신청서형 사이트에만 있다
  // '예약하기' 자동 클릭: 키이스케이프 Step2(opt-in) · 단편선(기본 on — 캡차 없음) · 제로월드(사용자 코드 입력 후 opt-in)
  // 신청서형 사이트: 마지막 버튼(예약 생성·결제 화면 이동) 자동 클릭은 사이트별 opt-in (기본 off, 켤 때 확인)
  $('subRow').style.display = 'flex';
  renderSub();
}
/** 자동 클릭 두 개(예약하기 / 결제하기) 의 라벨·체크박스·경고 문구를 현재 사이트/상태에 맞게 다시 그린다 */
function renderSub() {
  const dps = isDps();
  const pay = $('paybtn');
  if (pay) pay.checked = dps && localStorage.getItem('ke.paybtn') === '1';
  $('payWrap').style.display = dps ? 'inline-flex' : 'none';
  $('autosub').checked = subWanted();
  $('autosubLabel').textContent = isNaver() ? '신청서까지 자동 진행' : dps ? "'예약하기' 자동 클릭 (단편선 기본값)" : isForm() ? `최종 '${finalBtn()}'까지 자동 클릭` : "자동예약";
  $('subHint').innerHTML = isForm() ? ($('autosub').checked
    ? `<b style="color:#f55">신청서가 목표와 모두 맞으면 '${esc(finalBtn())}'을 1회 자동 클릭합니다 — ${esc(S.finalMeans || '예약 생성')}</b>. 실패해도 다시 누르지 않습니다.`
    : `마지막 '${esc(finalBtn())}'${josa(finalBtn(), '은', '는')} 직접 클릭합니다 (${esc(S.finalMeans || '예약 생성')}).`) : isNaver() ? (bankOn() ? '무통장입금 예약 확정까지 진행합니다. 실제 입금은 직접 진행하세요.' : S.naverBank ? '무통장입금 예약 확정 옵션을 켜면 최종 확정까지 진행합니다.' : '신청서까지 자동 진행합니다. 최종 확인·결제는 네이버 화면에서 직접 하세요.') : dps
    ? ('단편선은 캡차가 없어 <b>예약하기 자동 클릭이 기본</b>입니다. 클릭 후 결제화면에서 이름/연락처/입금자명 · 무통장입금 · <b>약관 전체동의</b>까지 자동 처리하고, '
      + (pay && pay.checked
        ? '마지막 <b style="color:#f55">\'결제하기\'까지 자동으로 1회 클릭합니다 — 결제가 실제로 진행됩니다</b>.'
        : '마지막 <b>\'결제하기\'</b> 는 위 체크박스를 켜지 않는 한 <b>사람이 클릭</b>합니다.'))
    : isZw() ? "자동입력방지 코드를 직접 입력하면 예약하기를 1회 클릭합니다." : "<b>reCAPTCHA 체크박스는 자동으로 1회 클릭</b>합니다. 문제가 나오면 직접 풀어 주세요. 토큰이 생긴 뒤 좌표/약관/예약자/금액을 검증하고 버튼을 <b>1회</b> 누릅니다(기본 off).";
}
/** 자동 제출은 확인 후에만 켠다 (제출 = 결제 화면으로 넘어가는 동작이기 때문) */
function onAutoSub() {
  if ($('autosub').checked && !confirm(isForm()
    ? `"${finalBtn()}" 까지 자동으로 1회 클릭합니다.\n\n• 예약좌표·이름·연락처·인원·결제수단·약관·금액이 목표와 모두 맞을 때만 누릅니다\n• 누르면 ${S.finalMeans || '예약 생성'}입니다\n• 응답이 불명확해도 다시 누르지 않습니다\n\n켤까요?`
    : isNaver() ? '선택한 날짜와 시간대를 확인하고 네이버 신청서까지 자동으로 진행합니다. 켤까요?' : isZw()
    ? '자동입력방지 코드를 직접 입력한 뒤 예약하기를 1회 클릭합니다. 코드가 틀리면 직접 수정해야 합니다. 켤까요?'
    : isDps()
    ? '"예약하기" 를 자동으로 1회 클릭합니다.\n\n• 예약좌표(상품/날짜) · 로그인 · 화면에 보이는 예약하기 버튼 1개를 확인한 뒤 누릅니다\n• 클릭하면 주문이 만들어지고 결제화면으로 넘어갑니다\n• 이름/연락처/입금자명 · 무통장입금 · 약관 전체동의가 자동으로 채워지며 중복 클릭은 하지 않습니다\n• 최종 "결제하기" 는 따로 켜지 않는 한 사람이 클릭합니다\n\n이대로 켤까요?'
    : '캡차 통과 후 "예약하기" 를 자동으로 1회 클릭합니다.\n\n• reCAPTCHA 체크박스는 자동 클릭하며, 문제가 나오면 직접 풀어 주세요\n• 예약좌표/약관/예약자/금액이 목표와 다르면 클릭하지 않습니다\n• 클릭 후 결제(KCP) 화면으로 넘어가며, 중복 클릭은 하지 않습니다\n\n이대로 켤까요?')) {
    $('autosub').checked = false;
  }
  localStorage.setItem(autoKey(), $('autosub').checked ? '1' : '0');
  // 결제까지 자동은 '예약하기' 자동이 전제다 — 예약하기를 끄면 결제하기 체크도 함께 끈다
  if (!$('autosub').checked && $('paybtn').checked) { $('paybtn').checked = false; localStorage.setItem('ke.paybtn', '0'); }
  if (!$('autosub').checked && $('naverConfirm')) { $('naverConfirm').checked = false; localStorage.setItem('ke.naver.bankConfirm', '0'); }
  renderSub();
  return true;
}
/** 최종 '결제하기' — 실제로 돈이 나가는 동작이라 확인 후에만 켜진다 (기본 off, 게이트 통과 시에만 1회 클릭) */
function onPayBtn() {
  if ($('paybtn').checked && !confirm('"결제하기" 까지 자동으로 누릅니다.\n\n• 무통장입금 주문이 확정되고 입금 안내가 뜹니다 (카드 등 다른 결제 화면이면 게이트가 거부합니다)\n• 화면에서 이름/연락처/입금자명 채워짐 + 무통장입금 선택 + 약관 전체 체크 + 금액 + 버튼 1개를 확인한 뒤 1회만 클릭합니다\n• 하나라도 걸리면 클릭하지 않고 로그에 이유를 남깁니다\n• \'예약하기\' 자동 클릭이 함께 켜집니다\n\n정말 켤까요?')) {
    $('paybtn').checked = false;
  } else if ($('paybtn').checked && !$('autosub').checked) {
    $('autosub').checked = true;
    localStorage.setItem(autoKey(), '1');
  }
  localStorage.setItem('ke.paybtn', $('paybtn').checked ? '1' : '0');
  renderSub();
  return true;
}
async function setSite(k) {
  if (S.site === k) return;
  lockVersion++; S.unlock = null;
  S.site = k; localStorage.setItem('ke.site', k);
  S.themes = []; S.date = ''; S.time = ''; S.branchSite = ''; OPEN_ISO = null;
  renderTabs(); copySite();
  $('theme').innerHTML = '';
  $('themeMeta').textContent = '테마를 고르면 정보가 나타납니다.';
  $('dates').innerHTML = "<span class=\"hint\">테마 선택 후 '오픈 창 스캔'을 누르면 날짜별 가능 슬롯 수가 나옵니다.</span>";
  $('slots').innerHTML = '<span class="hint">날짜를 선택하세요.</span>';
  $('openInfo').textContent = '날짜를 고르면 그 날짜가 예약 열리는 시각이 자동으로 세팅됩니다.';
  $('step2').innerHTML = '<div><b>waiting</b>아직 미도착</div>';
  $('bOpen').textContent = '오픈까지 -';
  await loadEnv();
  const last = JSON.parse(localStorage.getItem('ke.last.' + k) || 'null');
  if (last && last.zizum && document.querySelector(`#zizum option[value="${last.zizum}"]`)) $('zizum').value = last.zizum;
  await loadThemes();
  if (last && last.theme && S.themes.some((t) => String(t.theme) === String(last.theme))) { $('theme').value = last.theme; onTheme(); }
}
const DEF = { deadline: 60, name: '', hp: '' };   // 개인 값은 코드에 두지 않는다 — 입력값은 localStorage(ke.buyer) 에 저장
const esc = (s) => String(s).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));

/* ---------- 로그 ---------- */
function paint(line) {
  const cls = /\[(FAIL|MISS|WARN|BLOCK|ABORT)\]/.test(line) || (/\[EXIT\]/.test(line) && !/성공/.test(line)) ? 'r'
    : /\[(HIT|OK|STEP2|READY|POST|SLOTS|CAPTCHA|CHECK|SUBMIT|RESULT|ARM|WATCH|UNLOCK|SLOT|ORDER|AGREE|POLICY|PAY|PAYCHECK|LOGIN|PREVIEW|DPS)\]/.test(line) ? 'g'
    : /\[(POLL|WAIT|IDLE|NAV)\]/.test(line) ? 'd'
    : /\[(TODO|STOP|HANDOFF|ALERT)\]/.test(line) ? 'y' : '';
  return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
}
function logLine(o) {
  const pre = $('log');
  pre.insertAdjacentHTML('beforeend', (o.t ? `<span class="k">${esc(o.t)}</span> ` : '') + paint(o.line) + '\n');
  pre.scrollTop = pre.scrollHeight;
  window.bookingUI?.log(o.line || '');
}
function connect() {
  if (S.sse) S.sse.close();
  $('log').textContent = '';
  S.sse = new EventSource('/api/events');
  S.sse.onmessage = (e) => { const o = JSON.parse(e.data); if (o.line) logLine(o); if (o.event === 'exit') loadEnv(); };
}

async function reconnectBrowser() {
  const b = $('reconnectBrowser'); b.disabled = true; b.textContent = '브라우저 연결 중…';
  try {
    const r = await fetch('/api/browser/reconnect', { method: 'POST' }).then(r => r.json());
    if (!r.ok) return alert(r.msg || '브라우저 연결 실패');
    S.cdp = r.port;
    logLine({ t: '앱', line: '[READY] 예약 브라우저를 다시 연결했습니다. 예약 조건을 확인하고 실행해 주세요.' });
    await loadEnv();
    if (S.site === 'keyescape') await checkLock(true);
  } catch { alert('앱 연결을 확인하지 못했습니다. 예약도우미를 다시 실행해 주세요.'); }
  finally { b.disabled = false; b.textContent = '예약 브라우저 다시 연결'; }
}
async function openNaverWindow() {
  const t = cur(); if (!t) return alert('테마를 먼저 선택하세요');
  const button = $('naverOpen'); button.disabled = true;
  try {
    const r = await fetch(`/api/naver/open?zizum=${$('zizum').value}&theme=${t.theme}`, { method: 'POST' }).then(r => r.json());
    if (!r.ok) return alert(r.msg || '예약창 열기 실패');
    logLine({ t: 'UI', line: '[LOGIN] 네이버 예약창을 열었습니다. 로그인 후 상단 로그인 상태를 눌러 확인하세요.' });
    setTimeout(() => checkLogin(true), 4000);
  } catch { alert('예약용 브라우저 연결을 확인하세요'); }
  finally { button.disabled = false; }
}
/* ---------- 환경/지점/테마 ---------- */
const cur = () => S.themes.find((t) => String(t.theme) === $('theme').value);
async function loadEnv() {
  const site = S.site, epoch = S.runEpoch;
  const e = await (await fetch('/api/env?info=' + (cur()?.info || 34) + '&site=' + site)).json();
  if (S.site !== site || S.runEpoch !== epoch) return;
  if (S.cdp !== e.cdp_port) { lockVersion++; S.unlock = null; }
  S.cdp = e.cdp_port;
  S.naverBank = !!e.naverBank;
  S.finalButton = e.finalButton || ''; S.finalMeans = e.finalMeans || '';
  if (e.cdp !== 'OK' && S.site === 'keyescape' && !S.unlockFixing) { lockVersion++; updateLock('disconnected', '개발자모드 · 브라우저 연결 필요'); }
  $('reconnectBrowser').style.display = e.desktop ? '' : 'none';
  if (e.sites) S.sites = e.sites;
  renderTabs();
  if (!isNaver()) checkLock();
  const c = $('bCdp');
  c.textContent = e.desktop ? `예약 브라우저 ${e.cdp === 'OK' ? '연결됨' : '연결 끊김'}` : `CDP :${e.cdp_port} ${e.cdp === 'OK' ? '연결됨' : '없음'}`;
  c.className = 'badge ' + (e.cdp === 'OK' ? 'ok' : 'bad');
  c.title = (e.tabs || []).join('\n');
  S.today = e.serverToday || '';
  $('bToday').textContent = '서버기준일 ' + (e.serverToday || '-');
  $('bToday').title = e.serverMsg || '';
  if ($('depWrap')) $('depWrap').style.display = e.deposit ? '' : 'none';   // 입금자명은 무통장입금 사이트에서만
  checkLogin();
  const r = $('bRun');
  r.textContent = e.running ? '실행 중 (pid ' + e.pid + ')' : e.exit ? '마지막: ' + e.exit : '대기';
  r.className = 'badge ' + (e.running ? 'ok' : '');
  if (S.branchSite !== e.site || !$('zizum').options.length) {   // 사이트를 바꾸면 지점 목록이 통째로 바뀐다
    S.branchSite = e.site;
    $('zizum').innerHTML = (e.branches || []).map((b) => `<option value="${b.num}">${esc(b.name)}${isNaver() ? '' : ' (' + b.num + ')'}</option>`).join('');
    copySite();
  }
  document.title = '예약도우미';
  window.bookingUI?.environment(e);
}
async function loadThemes() {
  const site = S.site, branch = $('zizum').value;
  S.themes = []; S.date = ''; S.time = ''; S.matrix = []; OPEN_ISO = null;
  $('theme').innerHTML = '<option>테마 불러오는 중…</option>';
  $('dates').innerHTML = '<span class="hint">날짜를 불러오는 중…</span>';
  $('slots').innerHTML = '<span class="hint">날짜를 선택하세요.</span>';
  refreshUI();
  const d = await (await fetch('/api/themes?zizum=' + branch + '&site=' + site)).json();
  if (S.site !== site || $('zizum').value !== branch) return;
  S.themes = d.themes || [];
  if (!S.themes.length) { $('theme').innerHTML = '<option>조회 실패</option>'; $('themeMeta').textContent = d.msg || '테마 없음'; return; }
  $('theme').innerHTML = S.themes.map((t) => `<option value="${t.theme}">${esc(t.name)}</option>`).join('');
  onTheme();
}
function onTheme() {
  const t = cur(); if (!t) return;
  $('themeMeta').innerHTML = isNaver() ? '네이버 로그인 필요 · 예약창에서 계정 정보를 확인하세요.' : isForm()
    ? `theme=<b>${t.theme}</b> · ${t.personRange ? t.personRange + '명' : '인원 -'} · ${t.genre || '-'} · ${t.play ? t.play + '분' : '-'} · 신청서까지 자동 진행 후 최종 '${esc(finalBtn())}'${josa(finalBtn(), '은', '는')} 직접 클릭`
    : isZw()
    ? `themeNum=<b>${t.theme}</b> · ${t.minPerson ? t.minPerson + '인~' : '인원 -'} · 난이도 ${'●'.repeat(Number(t.level) || 0) || '-'} · ${t.genre || '-'} · ${t.play || '-'}분`
    : `themeNum=<b>${t.theme}</b> · themeInfoNum=<b>${t.info}</b> · 난이도 ${t.level || '-'} · ${t.genre || '-'} · ${t.play || '-'}분`;
  S.date = ''; S.time = ''; OPEN_ISO = null; S.matrix = [];
  refreshUI();
  $('slots').innerHTML = '<span class="hint">날짜를 선택하세요.</span>';
  localStorage.setItem('ke.last.' + S.site, JSON.stringify({ zizum: $('zizum').value, theme: $('theme').value }));
  loadMatrix();
}

/* ---------- 날짜 ---------- */
async function loadMatrix() {
  const site = S.site;
  const t = cur(); if (!t) return;
  $('dates').innerHTML = '<span class="hint">스캔 중…</span>';
  const d = await (await fetch(`/api/matrix?zizum=${$('zizum').value}&theme=${t.theme}&info=${t.info}&days=21&site=${S.site}`)).json();
  if (S.site !== site || cur() !== t) return;
  if (!d.ok) { $('dates').innerHTML = '<span class="hint">' + esc(d.msg || '실패') + '</span>'; return; }
  S.matrix = d.days;
  // 창 안(total>0) = 이미 예약이 열린 날짜 → 이번 UI 대상 아님. 창 밖(total=0) = 아직 오픈 전 → 대기 대상.
  const oc = (x) => (x.total ? 'noOpen()' : `pickDate('${x.date}')`);
  $('dates').innerHTML = d.days.map((x) => `<button type="button" class="dcell ${x.total ? 'opened' : 'future'} ${x.date === S.date ? 'sel' : ''}" data-d="${x.date}" onclick="${oc(x)}">${x.date.slice(5)}<small>${x.dow}</small><small>${isNaver() ? (x.past ? '즉시 확인' : '오픈 대기') : x.total ? '이미 오픈' : '오픈 대기'}</small></button>`).join('');
  const first = isNaver() ? (d.days.find(x => !x.past) || d.days[0]) : d.days.find((x) => !x.total);
  if (first && !S.date) pickDate(first.date);   // 가장 가까운 '아직 안 열린' 날짜를 기본 선택
}
function noOpen() {
  $('openInfo').innerHTML = '이미 예약이 열린 날짜입니다 — <b>아직 오픈 전인 날짜</b>만 대기/시도 대상으로 다룹니다.';
  // 단계별 화면은 openInfo 가 접힌 상세 영역 안이라 안 보인다 → 화면 오류줄(guided.js 의 alert)로 알린다
  if (window.bookingUI) alert('이미 예약이 열린 날짜예요. 예약 사이트에서 바로 예약하거나, ‘오픈 대기’ 날짜를 골라 주세요.');
}
function pickDate(d, force) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) { alert('YYYY-MM-DD 형식으로 입력하세요'); return; }
  const row = S.matrix.find((x) => x.date === d);
  if (!force && row && row.total > 0) return noOpen();
  if (window.bookingUI) alert('');   // noOpen 안내를 지운다 (단계별 화면의 alert = 오류줄)
  S.date = d; S.time = ''; OPEN_ISO = null; $('dateInput').value = d;
  refreshUI();
  document.querySelectorAll('.dcell').forEach((c) => c.classList.toggle('sel', c.dataset.d === d));
  loadSlots();
  loadOpenInfo().then(refreshUI);      // 이 날짜가 예약 열리는 시각을 자동 세팅
}
/* ---------- 시간대 (아직 오픈 전 날짜만 대상 → 하나만 고른다) ---------- */
let SLOT_CACHE = [];
let SLOT_PREVIEW = '';   // 선택 날짜가 예약 창 밖일 때, 시간표를 미리 심어준 날짜
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString();   // KST 벽시계
async function loadSlots() {
  const site = S.site, date = S.date;
  const t = cur(); if (!t || !S.date) return;
  $('slots').innerHTML = '<span class="hint">조회 중…</span>';
  const q = (dt) => `/api/slots?zizum=${$('zizum').value}&theme=${t.theme}&date=${dt}&site=${S.site}`;
  const d = await (await fetch(q(S.date))).json();
  if (S.site !== site || S.date !== date || cur() !== t) return;
  SLOT_CACHE = d.slots || [];
  SLOT_PREVIEW = '';
  if (isNaver()) $('openHint').textContent = d.msg || '네이버 화면에서 실제 회차를 확인합니다.';
  // 아직 예약 창 밖: 창 안의 같은 요일(없으면 가장 가까운 날짜) 시간표를 기준으로 고르고, 발사 때 서버 응답으로 실제 슬롯을 재확인한다
  // (평일/주말 시간표가 다르다 — 토끼굴 실측: 주말·공휴일만 첫 회차 10:05 가 있다. 오늘 날짜는 지난 회차가 빠져 있어 뒤로 미룬다)
  if (!SLOT_CACHE.length && S.date > (S.today || kstNow().slice(0, 10))) {
    const dow = (x) => new Date(x + 'T00:00:00Z').getUTCDay();
    const pool = S.matrix.filter((x) => x.total && x.date !== S.date);
    const today = S.today || kstNow().slice(0, 10);
    const alt = pool.find((x) => dow(x.date) === dow(S.date) && x.date !== today) || pool.find((x) => dow(x.date) === dow(S.date))
      || pool.find((x) => x.date !== today) || pool[0];
    if (alt) {
      const d2 = await (await fetch(q(alt.date))).json();
      if (S.site !== site || S.date !== date || cur() !== t) return;
      SLOT_CACHE = d2.slots || [];
      SLOT_PREVIEW = alt.date;
    }
  }
  if (!SLOT_CACHE.length) {
    $('slots').innerHTML = '<div class="hint slot-empty"><span>이 날짜는 아직 슬롯 목록이 없습니다.</span>'
      + (d.msg ? '<span>' + esc(d.msg) + '</span>' : '')
      + '<span>오픈 시각에 창이 열리면 채워집니다.</span></div>';
    return;
  }
  SLOT_CACHE = SLOT_CACHE.filter((s) => s.time);
  if (!SLOT_CACHE.some((s) => s.time === S.time)) S.time = '';   // 목록에 없는 시각 선택은 버린다
  $('slots').innerHTML = SLOT_CACHE.map((s) => {
    if (isZw() && !s.open) return `<button type="button" disabled class="chip wait dis" data-t="${s.time}">${s.time}<small>마감</small></button>`;   // disable = 마감 (사이트 범례 그대로)
    return `<button type="button" class="chip wait ${s.time === S.time ? 'sel' : ''}" data-t="${s.time}" onclick="pickTime('${s.time}')">${s.time}<small>${isNaver() ? '시간표 참고' : window.bookingUI ? '오픈 대기' : '오픈 대기 · ' + s.num}</small></button>`;
  }).join('');
}
function pickTime(t) {
  S.time = S.time === t ? '' : t;                     // 단선택 — 다시 클릭하면 해제
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('sel', c.dataset.t === S.time));
  refreshUI();
}
/* 예약자 정보는 폼으로 받고 브라우저에 기억한다 (reservation2 자동 입력값) */
function saveBuyer() {
  localStorage.setItem('ke.buyer', JSON.stringify({
    name: $('pname').value.trim(), hp: $('hp').value.trim(), dep: ($('dep') ? $('dep').value : '').trim(),
  }));
}
/* 로그인 배지 — 단편선은 로그인이 곧 예약 가능 여부다 (예약하기 버튼이 openLogin 으로 감싸여 있다) */
async function checkLogin(force) {
  const site = S.site;
  const b = $('bLogin');
  if (!b) return;
  if (force) { b.textContent = '로그인 확인 중…'; b.className = 'badge'; }
  const d = await fetch(`/api/login?site=${S.site}&cdp=${S.cdp || 9222}&zizum=${$('zizum').value}&theme=${cur()?.theme || ''}`).then((r) => r.json()).catch(() => null);
  if (S.site !== site) return;
  if (!d) { b.textContent = '로그인 확인 불가'; b.className = 'badge bad'; return; }
  if (!d.required) { b.textContent = '로그인 불필요'; b.className = 'badge'; b.title = d.msg || ''; return; }
  b.textContent = d.loggedIn === true ? ('로그인됨 ' + ((d.msg.match(/\((.+)\)/) || [])[1] || ''))
    : d.loggedIn === false ? '로그아웃 — 예약 불가' : '로그인 확인 불가';
  b.className = 'badge ' + (d.loggedIn === true ? 'ok' : d.loggedIn === false ? 'bad' : '');
  b.title = (d.msg || '') + (d.source ? ' / 출처: ' + d.source : '');
}

/* ---------- 오픈 시각 자동 계산 (입력란 없음 — 항상 서버 계산값) ---------- */
let OPEN_ISO = null;   // 서버가 계산한 정확한 KST ISO
const fmtLeft = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return (s >= 86400 ? Math.floor(s / 86400) + '일 ' : '') + Math.floor(s % 86400 / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분';
};
const openAtIso = () => OPEN_ISO;
async function loadOpenInfo() {
  const site = S.site, date = S.date;
  const t = cur(); if (!t || !S.date) return;
  const box = $('openInfo');
  box.textContent = '이 날짜의 오픈 시각 계산 중…';
  const d = await fetch(`/api/openinfo?zizum=${$('zizum').value}&theme=${t.theme}&info=${t.info}&date=${S.date}&site=${S.site}`).then((r) => r.json()).catch(() => null);
  if (S.site !== site || S.date !== date || cur() !== t) return;
  if (!d || !d.ok) {
    OPEN_ISO = null; $('bOpen').textContent = '오픈까지 -';
    box.innerHTML = '오픈 시각을 계산하지 못했습니다 — ' + esc((d && (d.note || d.msg)) || '응답 없음');
    return;
  }
  OPEN_ISO = d.openAt;
  box.innerHTML = `<b>${esc(d.branch || '')}</b> 오픈 <b>${d.openTime}</b> (출처: ${esc(d.openTimeSource)}) · `
    + `<b>${S.date}</b> 예약 오픈 <b>${d.openDate} ${d.openTime}</b> (D-${d.leadDays}, ${esc(d.leadSource)})`
    + (d.windowEnd ? ` · 현재 예약 창 끝 ${d.windowEnd}` : '')
    + (d.past ? ' <b style="color:#f7a">이미 오픈</b>' : ` · <b>${fmtLeft(d.msUntil)} 남음</b>`);
}

/* ---------- 실행: 오픈 시각에 고른 시간대 '하나'만 시도 ---------- */
async function fire(dry, wo) {
  const t = cur();
  if (!t || !S.date) return alert('테마와 날짜를 먼저 고르세요');
  if (!dry && !S.time) return alert('시간대를 하나 선택하세요');
  const name = ($('pname').value || '').trim();
  const hp = ($('hp').value || '').trim();
  if (!isNaver() && !dry && !wo && (!name || !hp)) return alert(isZw() ? '예약자 이름/연락처 를 입력하세요 — 예약 폼에 채워질 값입니다' : '예약자 이름/휴대폰 을 입력하세요 — reservation2 폼에 채워질 값입니다');
  const body = {
    site: S.site,
    zizum: $('zizum').value, theme: t.theme, info: t.info, date: S.date, tname: t.name,
    times: S.time, deadline: DEF.deadline, name: name || DEF.name, hp: hp || DEF.hp,
    dep: ($('dep').value || '').trim(),
  };
  if (isForm()) {
    // 신청서형 사이트는 오픈 시각 공지가 없어 예약 창이 밀리는 자정으로 본다 → 조회가 시작되는 순간을 넓게 잡는다
    body.deadline = Math.max(DEF.deadline, 600);
    const p = $('rhePerson') ? $('rhePerson').value : '';
    if (p) body.person = p;   // 신청서의 '예약 인원' — 미선택이면 러너가 화면의 테마 최소 인원으로 채운다
  }
  if (isNaver()) { delete body.name; delete body.hp; delete body.dep; }
  if (bankOn() && !dry && !wo) {
    if (!$('autosub').checked) return alert('신청서까지 자동 진행을 먼저 켜 주세요.');
    body.bankConfirm = true; body.bankMax = Number($('naverBankMax').value);
    if (!Number.isSafeInteger(body.bankMax) || body.bankMax <= 0) return alert('무통장입금 예약금 상한을 입력해 주세요.');
  }

  if (dry) body.dry = true;
  else {
    const iso = openAtIso();
    if (!iso) return alert('이 날짜의 오픈 시각을 계산하지 못했습니다 — 다른 날짜를 고르거나 다시 조회하세요');
    if (new Date(iso).getTime() < Date.now() && !confirm('이미 오픈된 날짜입니다. 즉시 시도합니다. 계속할까요?')) return;
    body.openAt = iso;
  }
  if (!dry && !wo && $('autosub') && isForm()) body.finalSubmit = $('autosub').checked;   // 신청서형: 최종 버튼 자동 1회 (opt-in)
  if (!dry && !wo && $('autosub') && !isForm()) {
    body.autoSubmit = $('autosub').checked;      // 단편선은 서버가 autoSubmit===false 를 --no-auto-submit 으로 바꾼다
    if (isDps() && $('paybtn').checked) body.paySubmit = true;   // 최종 '결제하기' — 이 체크박스에서만 켜진다 (기본 off)
  }
  if (wo) body.watchOnly = true;   // 디버거 미연결 — 사이트 차단과 무관하게 항상 동작
  S.runEpoch = (S.runEpoch || 0) + 1;
  window.bookingUI?.starting(body);
  let r;
  try { r = await (await fetch('/api/run', { method: 'POST', body: JSON.stringify(body) })).json(); }
  catch (e) { window.bookingUI?.startFailed(); throw e; }
  if (!r.ok) { window.bookingUI?.startFailed(); return alert(r.msg); }
  window.bookingUI?.started();
  saveBuyer();
  $('log').textContent = '';
  logLine({ t: 'UI', line: `[READY] 실행 시작 pid=${r.pid} | ${body.date}${dry ? ' (슬롯 조회만)' : (wo ? ' (감시 전용 — 디버거 미연결)' : ' ' + body.times)}`
    + ` ${body.openAt ? '@' + body.openAt : '즉시'}` + (body.paySubmit ? ' · 결제하기까지 자동 클릭' : '') });
  loadEnv();
}
const reserve = () => fire(false);
async function stop() {
  const r = await (await fetch('/api/stop', { method: 'POST' })).json();
  logLine({ t: 'UI', line: '[STOP] ' + (r.ok ? '중단 요청함' : r.msg) });
  loadEnv();
}

/* ---------- 대상 페이지 상태 (KE: reservation2 / ZW: 예약 폼 / RHE: 신청서) · 카운트다운 ---------- */
async function loadStep2() {
  const d = await (await fetch(`/api/step2?site=${S.site}&zizum=${$('zizum').value}&theme=${cur()?.theme || ''}&date=${S.date}&time=${S.time}`)).json();
  if (!d.ok) { $('step2').innerHTML = `<div><b>확인 실패</b>${esc(d.msg)}</div>`; return; }
  const cell = (k, v) => `<div><b>${k}</b>${esc(v || '-')}</div>`;
  const fillCell = (x) => cell('자동입력', x.fillMs != null ? x.fillMs.toFixed(0) + 'ms' + (x.fillErr ? ' (미완)' : '') : (x.fillErr || '대기'));
  if (d.site === 'naver') {
    $('step2').innerHTML = [cell('예약 상태', d.msg || (d.loaded ? '회차 확인됨' : '대기')), cell('선택 날짜', d.date), cell('목표 시간', S.time)].join('');
    return;
  }
  if (isForm(d.site)) {
    if (!d.onCreate && !d.onDone) { $('step2').innerHTML = `<div><b>waiting</b>신청서 화면 아님 · ${esc((d.href || d.msg || '').slice(-40))}</div>`; return; }
    const coord = Object.entries(d.hidden || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(' ');
    $('step2').innerHTML = [
      cell('예약좌표', coord || [d.date, d.slotLabel || d.slot].filter(Boolean).join(' ') || d.summary || '-'),
      cell('이름/연락처', `${d.name || '-'} / ${d.phone || '-'}`),
      cell('인원/요금', `${d.people || '-'}명 · ${d.price || '-'}`),
      d.pay ? cell('결제수단', d.pay) : '',
      d.policy == null ? '' : cell('약관', d.policy ? '✅ 동의됨' : '⚠ 직접 동의 필요'),
      fillCell({ fillMs: d.fillMs != null ? d.fillMs : null, fillErr: d.fillMissing ? '누락: ' + d.fillMissing : (d.fillState === 'done' ? '' : '대기') }),
      cell(finalBtn(), d.onDone ? '완료·결제 화면입니다' : `사람 클릭 — 누르면 ${esc(S.finalMeans || '예약 생성')}`),
    ].join('');
    return;
  }
  if (d.site === 'zeroworld') {
    if (!d.onZw) { $('step2').innerHTML = `<div><b>waiting</b>제로월드 예약 페이지 아님 · ${esc((d.url || '').slice(-40))}</div>`; return; }
    $('step2').innerHTML = [
      cell('선택좌표', Object.entries(d.hidden || {}).map(([k, v]) => `${k}=${v}`).join(' ') || d.msg),
      cell('이름/연락처', `${d.name || '-'} / ${d.mobile || '-'}`),
      cell('인원', d.person || '-'),
      fillCell(d),
      cell('이미지 코드', d.captcha === '입력됨' ? '✅ 입력됨 — 예약하기만!' : '⚠ 직접 입력 필요'),
      cell('예약하기', d.btnActive ? '활성화됨' : '비활성 (날짜/테마/시간 선택 필요)'),
    ].join('');
    return;
  }
  if (!d.onStep2) { $('step2').innerHTML = `<div><b>waiting</b>reservation2 아님 · ${esc((d.url || '').slice(-40))}</div>`; return; }
  $('step2').innerHTML = [
    cell('예약좌표', Object.entries(d.hidden || {}).map(([k, v]) => `${k}=${v}`).join(' ') || d.good),
    cell('이름/연락처', `${d.name || '-'} / ${d.mob || '-'}`),
    cell('약관', d.agree || '-'),
    fillCell(d),
    cell('reCAPTCHA', d.captcha > 0 ? '✅ 완료 — 예약하기만!' : d.captchaClickRequested ? '체크박스 클릭 요청됨 · 문제가 나오면 직접 풀어 주세요' : '체크박스 자동 클릭 대기'),
  ].join('');
}
/* ---------- DevTools 차단 상태 / 복구 ---------- */
let lockTick = 0, lockCheck = null, lockVersion = 0;
function updateLock(state, message) {
  S.unlock = { state, message, checkedAt: Date.now() };
  const b = $('bLock'); b.textContent = message;
  b.className = 'badge ' + (state === 'active' ? 'ok' : ['inactive', 'error', 'disconnected'].includes(state) ? 'bad' : '');
  refreshUI();
}
function readLockStatus(d) {
  if (!d || !['OK', 'DOWN'].includes(d.cdp)) return updateLock('error', '개발자모드 확인 불가');
  if (d.cdp === 'DOWN') return updateLock('disconnected', '개발자모드 · 브라우저 연결 필요');
  // No tab is not proof that injection succeeded, even if allUnlocked is true.
  if (d.count === 0) return updateLock('no-tab', '개발자모드 · 예약창 없음');
  if (!(d.count > 0)) return updateLock('error', '개발자모드 확인 불가');
  updateLock(d.allUnlocked === true ? 'active' : 'inactive', d.allUnlocked === true ? '개발자모드 활성화됨' : '개발자모드 비활성');
}
async function checkLock(force) {
  if (isNaver() || S.unlockFixing) return;
  if (window.bookingUI && S.site !== 'keyescape') return;
  if (lockCheck) { if (force) { await lockCheck; return checkLock(true); } return lockCheck; }
  // Guided UI refreshes on every 15-second environment check. Classic keeps its cadence.
  if (!force && !window.bookingUI && lockTick++ % 4) return;
  const version = lockVersion, site = S.site;
  if (!S.unlock) updateLock('checking', '개발자모드 확인 중');
  lockCheck = (async () => {
    const d = await fetch('/api/unlock' + (S.cdp ? '?cdp=' + S.cdp : ''), { signal: AbortSignal.timeout(30000) }).then(r => r.json()).catch(() => null);
    if (version !== lockVersion || S.site !== site) return;
    readLockStatus(d);
  })();
  try { await lockCheck; } finally { lockCheck = null; }
}
async function lockFix() {
  if (isNaver() || S.unlockFixing) return;
  S.unlockFixing = true; lockVersion++;
  updateLock('activating', '개발자모드 활성화 중…');
  try {
    const response = await fetch('/api/unlock', { method: 'POST', signal: AbortSignal.timeout(100000) });
    const d = await response.json();
    if (!response.ok || !d.fixed) {
      updateLock('error', '개발자모드 활성화 실패');
      return alert(d.msg || '개발자모드를 활성화하지 못했습니다. 다시 시도해 주세요.');
    }
    readLockStatus(d);
    logLine({ t: 'UI', line: '[UNLOCK] ' + S.unlock.message });
  } catch {
    updateLock('error', '개발자모드 활성화 실패');
  } finally {
    S.unlockFixing = false;
    refreshUI();
  }
}

/* 오픈 카운트다운 (서버가 계산한 KST ISO 우선) */
setInterval(() => {
  const iso = openAtIso();
  if (!iso) { $('bOpen').textContent = '오픈까지 -'; return; }
  const left = (new Date(iso).getTime() - Date.now()) / 1000;
  $('bOpen').textContent = left > 0
    ? `오픈까지 ${Math.floor(left / 3600)}:${String(Math.floor(left / 60) % 60).padStart(2, '0')}:${String(Math.floor(left) % 60).padStart(2, '0')}`
    : '오픈 시각 경과';
}, 1000);

/* ---------- 시작 ---------- */
$('zizum').onchange = loadThemes;
$('theme').onchange = onTheme;
$('pname').onchange = $('hp').onchange = $('dep').onchange = saveBuyer;
if ($('rhePerson')) {   // 토끼굴 신청서의 '예약 인원' — 비워 두면 러너가 화면의 테마 최소 인원으로 채운다
  $('rhePerson').value = localStorage.getItem('ke.person') || '';
  $('rhePerson').onchange = () => localStorage.setItem('ke.person', $('rhePerson').value);
}
(async () => {
  renderTabs(); copySite();
  connect();
  await loadEnv();
  const b = JSON.parse(localStorage.getItem('ke.buyer') || 'null');
  if (b && b.name) $('pname').value = b.name;
  if (b && b.hp) $('hp').value = b.hp;
  if (b && b.dep) $('dep').value = b.dep;
  const last = JSON.parse(localStorage.getItem('ke.last.' + S.site) || 'null');
  if (last && last.zizum && document.querySelector(`#zizum option[value="${last.zizum}"]`)) $('zizum').value = last.zizum;
  await loadThemes();
  if (last && last.theme && S.themes.some((t) => String(t.theme) === String(last.theme))) { $('theme').value = last.theme; onTheme(); }
  setInterval(() => { if (!document.hidden) loadStep2(); }, 4000);
  setInterval(loadEnv, 15000);
})().catch(() => alert('데이터를 불러오지 못했습니다. 연결을 확인하고 상태 새로고침을 눌러 주세요.'));

// Switching presentation must never hide or restart an active booking.
document.querySelectorAll('[data-design-link]').forEach(link => link.addEventListener('click', async event => {
  event.preventDefault();
  const r = await fetch('/api/log').then(r => r.json()).catch(() => null);
  if (!r || r.running || r.preparing) return alert('진행 중인 예약을 먼저 중단한 뒤 화면을 전환해 주세요.');
  location.href = link.href;
}));
