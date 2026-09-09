#!/usr/bin/env node
/**
 * reservation2 약관 동의 체크.  **제출(.submit 클릭) 은 하지 않는다.**
 *   node agree.mjs          # 필수 2개만: agree_1(개인정보 수집) + agree_2(결제 주의사항)
 *   node agree.mjs --all    # agree_all 전체동의 (선택항목 마케팅 수신까지 함께 체크됨)
 *   node agree.mjs --clear  # 전부 해제
 * 실제 페이지의 jQuery 캐스케이드가 동작하도록 실제 click 이벤트로 클릭한다.
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const MODE = process.argv.includes('--all') ? 'all' : process.argv.includes('--clear') ? 'clear' : 'required';
const TARGETS = MODE === 'all' ? ['agree_all'] : MODE === 'clear' ? [] : ['agree_1', 'agree_2'];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page' && /reservation2/.test(t.url));
if (!tab) { console.error('reservation2 탭 없음'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');

const out = await (async () => {
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const TARGETS = ${JSON.stringify(TARGETS)};
      const done = [];
      for (const k of TARGETS) {
        const el = document.querySelector('#' + k) || document.querySelector('[name=' + k + ']');
        if (!el) { done.push(k + ': 없음'); continue; }
        if (!el.checked) el.click();                 // 실제 클릭 -> 캐스케이드 동작
        done.push(k + (el.checked ? ': 체크' : ': 실패'));
      }
      if (${JSON.stringify(MODE)} === 'clear') {
        [...document.querySelectorAll('#agree_all, .agree_btn')].forEach((e) => { if (e.checked) e.click(); });
      }
      const state = {};
      [...document.querySelectorAll('#agree_all, [name^=agree_]')].forEach((e) => (state[e.id || e.name] = e.checked ? '체크됨' : '미체크'));
      return {
        done, state,
        marketing: (document.querySelector('[name=agree_3]') || {}).checked ? '동의됨(마케팅 수신)' : '미동의',
        captcha: (document.querySelector('[name=g-recaptcha-response]') || {}).value?.length || 0,
        fields: ['name', 'mobile1', 'mobile2', 'mobile3'].map((n) => n + '=' + (document.querySelector('[name=' + n + ']') || {}).value).join(' '),
        clickedSubmit: false,
      };
    })()`,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
})();

console.log('모드       :', MODE, '| 대상:', TARGETS.join(', ') || '(해제)');
console.log('작업       :', out.done.join(' / ') || '체크 해제만 수행');
console.log('약관 상태  :', JSON.stringify(out.state));
console.log('마케팅 수신 :', out.marketing);
console.log('입력값     :', out.fields);
console.log('reCAPTCHA  :', out.captcha === 0 ? '미완료(응답 0) — 사용자가 직접 체크 필요' : `완료(응답 ${out.captcha}자)`);
console.log('제출 버튼  : 클릭하지 않음 (.submit / 예약하기 비활건 그대로)');
ws.close();
