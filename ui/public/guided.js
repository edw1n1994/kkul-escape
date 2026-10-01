/* Guided presentation. All booking requests and safeguards live in app.js. */
(() => {
  let step = 0, busy = false, running = false, finished = false, runSelection = null, env = null;
  let phase = 'wait', stopping = false, localStart = false;
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const showError = message => { text('wizardError', String(message)); };
  const error = e => showError(e?.message || '연결을 확인하지 못했어요. 다시 시도해 주세요.');
  window.alert = showError;
  const formatOpen = iso => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '날짜 선택 후 확인';
  function sync() {
    const locked = busy || running;
    if (locked || finished) step = 3;
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = +p.dataset.panel !== step; });
    document.querySelector('.progress').hidden = step === 3;
    document.querySelectorAll('[data-step]').forEach(p => { if (+p.dataset.step === step) p.setAttribute('aria-current', 'step'); else p.removeAttribute('aria-current'); });
    for (const id of ['siteFields', 'scheduleFields', 'confirmFields']) $(id).disabled = locked || !!S.unlockFixing;
    for (const id of ['bLock', 'naverOpen', 'reconnectBrowser']) $(id).disabled = locked || !!S.unlockFixing;
    document.querySelectorAll('[data-advanced]').forEach(b => { b.disabled = locked; });
    const chosen = (locked || finished) && runSelection;
    const site = chosen?.site || S.site;
    const keyescape = site === 'keyescape';
    $('developerControls').hidden = !keyescape;
    $('developerStatus').hidden = !keyescape;
    const mode = S.unlock || { state: 'checking', message: '개발자모드 확인 중' };
    for (const id of ['developerStatus', 'developerInlineStatus']) {
      text(id, mode.message); $(id).dataset.state = mode.state;
      $(id).title = mode.checkedAt ? '마지막 확인: ' + new Date(mode.checkedAt).toLocaleTimeString('ko-KR') : '';
    }
    $('enableDeveloper').disabled = locked || !!S.unlockFixing || mode.state === 'active';
    text('enableDeveloper', S.unlockFixing ? '활성화 중…' : '개발자모드 활성화');

    const date = chosen?.date || S.date, time = chosen?.times || S.time;
    const iso = chosen?.openAt || OPEN_ISO;
    const label = S.sites.find(s => s.key === site)?.label || site;
    text('summarySite', chosen ? label : label + ' · ' + ($('zizum').selectedOptions[0]?.textContent.replace(/ \([^)]*\)$/, '') || '지점 선택'));
    text('summaryTheme', chosen?.tname || cur()?.name || '테마를 선택해 주세요');
    text('summaryDate', date || '아직 선택하지 않았어요'); text('summaryTime', time || '아직 선택하지 않았어요');
    text('summaryOpen', formatOpen(iso)); text('runOpen', formatOpen(iso));
    text('scheduleOpen', OPEN_ISO ? formatOpen(OPEN_ISO) + '에 예약이 열려요. 미리 대기를 시작해 두세요.' : '예약 오픈 시각을 확인하고 있어요. 날짜를 선택하거나 다시 조회해 주세요.');
    const connected = env?.cdp === 'OK';
    text('connectionStatus', env ? connected ? '● 브라우저 연결됨' : '브라우저 연결 필요' : '브라우저 확인 중…');
    $('connectionStatus').dataset.ready = String(connected);
    text('readyBrowser', connected ? '예약용 브라우저 연결됨' : '예약용 브라우저 연결을 확인해 주세요');
    text('loginHelp', isNaver() || isDps() ? '열린 예약 사이트에서 로그인한 후 ‘로그인 확인’을 눌러 주세요.' : '로그인 없이 예약할 수 있어요. 다음 단계에서 예약자 정보를 입력해 주세요.');
    $('verifyLogin').hidden = !(isNaver() || isDps());
    text('accountHelp', isNaver() ? '네이버 계정의 예약자 정보를 사용해요.' : '입력한 이름과 연락처는 이 앱에 저장돼 다음에도 사용할 수 있어요.');
    $('paymentOptions').hidden = !isDps();
    $('naverBankOptions').hidden = !isNaver();
    $('naverBankLimit').hidden = !$('naverConfirm').checked;

    text('autoHelp', isRhe() ? '시간 버튼까지 자동으로 누르고 신청서(이름·연락처·인원·결제수단·약관)를 채워요. 최종 ‘예약하기’는 예약 생성 + 가상계좌 발급이라 직접 눌러 주세요.' : isNaver() ? ($('naverConfirm').checked ? '무통장입금 예약 확정까지 진행해요. 계좌·입금 기한 확인과 송금은 직접 해 주세요.' : '무통장입금 예약 확정까지 자동으로 진행하려면 아래 옵션을 켜 주세요.') : isZw() ? '자동입력방지 코드를 직접 입력하면 예약하기를 눌러요.' : isDps() ? ($('paybtn').checked ? '최종 결제하기까지 자동 클릭하도록 설정되어 있어요.' : '예약하기까지 진행해요. 최종 결제는 직접 확인해 주세요.') : '체크박스는 자동으로 눌러요. 문제가 나오면 직접 풀어 주세요. 인증 후 예약하기를 눌러요.');
    $('wizardBack').disabled = step === 0 || stopping;
    text('wizardBack', running || busy ? '대기 중단' : '이전');
    $('wizardBack').hidden = finished;
    $('wizardNext').disabled = locked || !!S.unlockFixing;
    text('wizardNext', busy ? '예약 준비 중…' : running ? '예약 진행 중' : finished ? '예약 설정으로 돌아가기' : ['날짜와 시간 선택 →', '준비 내용 확인 →', '예약 대기 시작하기'][step]);
    if (step === 3) {
      const manual = phase === 'manual';
      text('runTitle', busy ? '예약을 준비하고 있어요' : finished ? (phase === 'failed' ? '예약 진행이 중단됐어요' : stopping ? '예약 대기를 중단했어요' : '예약창에서 결과를 확인해 주세요') : manual ? '예약창에서 확인해 주세요' : '예약 오픈을 기다리고 있어요');
      text('runState', busy ? '브라우저 연결을 확인하고 있어요' : finished ? '작업 종료' : manual ? '직접 인증·확인이 필요한 단계예요' : '예약 대기 중');
      text('runHelp', phase === 'failed' ? '상세 기록에서 중단 이유를 확인해 주세요. 자동으로 다시 시도하지 않아요.' : finished ? '앱 작업 종료는 예약 완료를 뜻하지 않아요. 예약 사이트에서 결과를 확인해 주세요.' : '앱과 예약용 브라우저를 열어 두세요. 필요한 인증은 직접 진행해 주세요.');
    }
    const ms = iso ? Date.parse(iso) - Date.now() : NaN;
    text('countdown', finished || phase === 'manual' ? '브라우저 확인' : !Number.isFinite(ms) ? '준비 중' : ms <= 0 ? '회차 확인 중' : Math.floor(ms / 3600000) + ':' + String(Math.floor(ms / 60000) % 60).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0'));
  }
  function go(next) { step = next; showError(''); sync(); }
  async function next() {
    if (running || busy || S.unlockFixing) return;
    if (finished) { finished = false; runSelection = null; stopping = false; phase = 'wait'; go(2); return; }
    if (!cur()) return showError('지점과 테마를 먼저 선택해 주세요.');
    if (step === 0) {
      if (env?.cdp !== 'OK') return showError('예약용 브라우저를 먼저 연결해 주세요.');
      if ((isNaver() || isDps()) && !$('bLogin').classList.contains('ok')) return showError('예약 사이트에 로그인한 후 ‘로그인 확인’을 눌러 주세요.');
      return go(1);
    }
    if (!S.date || !S.time) return showError('방문 날짜와 시간을 하나씩 선택해 주세요.');
    if (!OPEN_ISO) return showError('예약 오픈 시각을 확인하지 못했어요. 날짜와 시간을 다시 조회해 주세요.');
    if (step === 1) return go(2);
    if (!isNaver() && (!$('pname').value.trim() || !$('hp').value.trim())) return showError('예약자 이름과 휴대폰 번호를 입력해 주세요.');
    showError('');
    try { await reserve(); } catch (e) { error(e); }
  }
  async function openBrowser() {
    const b = $('prepareBrowser'); b.disabled = true;
    try {
      const selected = (running || finished) && runSelection;
      const query = new URLSearchParams({ site: selected?.site || S.site, zizum: selected?.zizum || $('zizum').value, theme: selected?.theme || cur()?.theme || '', focusOnly: (running || finished) ? '1' : '0' });
      const r = await fetch('/api/browser/open?' + query, { method: 'POST' }).then(r => r.json());
      if (!r.ok) return showError(r.msg || '브라우저를 열지 못했어요.');
      await loadEnv();
      if (S.site === 'keyescape') await checkLock(true);
    } catch (e) { error(e); } finally { b.disabled = false; sync(); }
  }
  $('naverConfirm').checked = localStorage.getItem('ke.naver.bankConfirm') === '1';
  $('naverBankMax').value = localStorage.getItem('ke.naver.bankMax') || '';
  $('naverConfirm').onchange = () => {
    if ($('naverConfirm').checked && !confirm('무통장입금 방식과 예약금 상한을 확인한 뒤 예약 확정 버튼을 1회 누릅니다. 필수 약관에 동의하여 예약이 생성되며, 실제 송금은 직접 진행해야 합니다. 켤까요?')) $('naverConfirm').checked = false;
    if ($('naverConfirm').checked) { localStorage.setItem(autoKey(), '1'); renderSub(); }
    localStorage.setItem('ke.naver.bankConfirm', $('naverConfirm').checked ? '1' : '0'); renderSub(); sync();
  };
  $('naverBankMax').onchange = () => localStorage.setItem('ke.naver.bankMax', $('naverBankMax').value);
  $('enableDeveloper').onclick = () => lockFix().catch(error);
  $('prepareBrowser').onclick = openBrowser; $('showBrowser').onclick = openBrowser;
  $('verifyLogin').onclick = () => checkLogin(true).then(sync).catch(error);
  $('wizardNext').onclick = next;
  $('wizardBack').onclick = async () => {
    if (running || busy) { stopping = true; sync(); try { await stop(); } catch(e) { stopping = false; error(e); } sync(); }
    else go(Math.max(0, step - 1));
  };
  window.bookingUI = {
    sync,
    environment(e) {
      env = e;
      // The server owns run status. Recover active work even after a page reload.
      if (e.running || e.preparing) { running = !!e.running; busy = !!e.preparing; finished = false; if (e.selection) runSelection = e.selection; }
      else if ((running || busy) && !localStart) { running = false; busy = false; finished = true; if (e.exit && !/성공|SIGTERM/.test(e.exit)) phase = 'failed'; }
      sync();
    },
    starting(body) { localStart = true; busy = true; finished = false; stopping = false; phase = 'wait'; runSelection = { ...body }; showError(''); sync(); },
    started() { localStart = false; busy = false; running = true; sync(); },
    startFailed() { localStart = false; busy = false; running = false; runSelection = null; step = 2; sync(); },
    log(line) { if ((running || busy) && /\[(ARM|STEP2|HANDOFF|ORDER|CREATE|RESULT|DONE)\]/.test(line)) { phase = 'manual'; sync(); } },
  };
  document.addEventListener('change', sync);
  window.addEventListener('unhandledrejection', event => { error(event.reason); });
  setInterval(sync, 1000);
  sync();
})();
