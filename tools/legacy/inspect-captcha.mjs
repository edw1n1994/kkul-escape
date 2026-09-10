#!/usr/bin/env node
/** reservation2 의 reCAPTCHA / 약관 체크 구조를 읽기 전용으로inspect (클릭·제출 없음) */
const PORT = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!tab) { console.error('탭 없음'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('접속 실패')); });
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
const r = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const box = document.querySelector('.g-recaptcha, [data-sitekey], #recaptcha, [id^=recaptcha]');
    const frames = [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 90));
    const ta = document.querySelector('[name=g-recaptcha-response]');
    const agree = [...document.querySelectorAll('[id^=agree],[name^=agree]')].map((e) => ({
      key: e.id || e.name, tag: e.tagName, type: e.type, checked: !!e.checked,
      label: (e.closest('label,li,div,p')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 46),
    }));
    const scripts = [...document.querySelectorAll('script')].map((s) => (s.src || s.textContent)).join('\\n');
    return {
      url: location.href,
      recaptchaWidget: box ? (box.className || box.id || 'el') : '없음',
      sitekey: (box && (box.dataset.sitekey || (box.outerHTML.match(/sitekey[^\\w]([^"\\'\\s>]{10,50})/) || [])[1])) || '확인불가',
      respValueLen: ta ? (ta.value || '').length : -1,
      respVisible: ta ? !!(ta.offsetWidth || ta.offsetHeight) : false,
      frames,
      hasGrecaptchaApi: typeof window.grecaptcha,
      agreeElements: agree,
      apiScript: (scripts.match(/recaptcha[^"'<>]{0,80}/gi) || []).slice(0, 6),
      submitGuard: (scripts.match(/(agree_1|agree_all)[^;{]{0,160}/g) || []).slice(0, 4),
    };
  })()`,
});
if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
const o = r.result.value;
console.log('URL            :', o.url);
console.log('위젯           :', o.recaptchaWidget, '| sitekey:', o.sitekey);
console.log('grecaptcha API :', o.hasGrecaptchaApi, '| 응답 길이:', o.respValueLen, '(0 이면 미완료)');
console.log('iframe         :', o.frames.join(' , ') || '없음');
console.log('스크립트 참조  :', (o.apiScript || []).join(' | '));
console.log('\\n-- 약관/동의 요소 --');
for (const a of o.agreeElements) console.log('  ' + String(a.key).padEnd(12), a.tag.padEnd(6), String(a.type).padEnd(9), a.checked ? '체크됨' : '미체크', '|', a.label);
console.log('\\n-- 제출 단서(agree 참조 코드) --');
for (const s of (o.submitGuard || [])) console.log('  ', s.replace(/\s+/g, ' ').slice(0, 150));
ws.close();
