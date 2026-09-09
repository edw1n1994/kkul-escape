#!/usr/bin/env node
/** reservation2 현재 상태를 브라우저에서 직접 읽어 되돌려 prints (쓰기 동작 없음) */
const PORT = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!pages.length) { console.error('keyescape 탭 없음'); process.exit(1); }
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
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
      const vis = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].map((e) => ({
        name: e.name || e.id, tag: e.tagName, type: e.type || '',
        value: e.type === 'checkbox' ? (e.checked ? '체크됨' : '미체크') : (e.value || ''),
      }));
      const hid = {};
      [...document.querySelectorAll('input[type=hidden]')].forEach((e) => {
        if (e.name && e.value && ['device','t','theme_info_num','zizum_num','theme_num','rev_days','theme_time_num','rev_price','good_name','good_mny','pay_method','use_pay_method'].includes(e.name)) hid[e.name] = e.value;
      });
      const btn = [...document.querySelectorAll('button, input[type=submit], a.btn_next_step')].map((b) => (b.innerText || b.value || '').trim()).filter((x) => x && x.length < 24);
      return { url: location.href, title: document.title, visible: vis, hidden: hid, buttons: [...new Set(btn)], notice: document.body.innerText.replace(/\\s+/g, ' ').match(/예약 상품 정보.{0,150}/)?.[0] || '' };
    })()`,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
})();

console.log('URL   :', out.url);
console.log('제목  :', out.title);
console.log('상품  :', out.notice);
console.log('\n-- 서버가 넘긴 숨은값(예약 좌표) --');
for (const [k, v] of Object.entries(out.hidden)) console.log('  ' + k.padEnd(18), '=', v);
console.log('\n-- 사용자 입력 필드 현재값 --');
for (const f of out.visible) console.log('  ' + String(f.name).padEnd(22), f.tag.padEnd(6), String(f.type).padEnd(10), '=', f.value);
console.log('\n-- 화면 버튼 --', out.buttons.join(' / '));
ws.close();
